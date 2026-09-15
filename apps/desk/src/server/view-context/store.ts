import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DESK_VIEW_TTL_MS, type DeskView } from "@/view-context/types";
import { HermesApiError } from "../hermes-records";
import { tabId, viewReference } from "./validation";
const token = () => randomBytes(32).toString("base64url");
const ownerHash = (owner: string) =>
  createHash("sha256").update(owner).digest("hex");
function unavailable(): never {
  throw new HermesApiError(
    "The current Desk view is unavailable.",
    503,
    "desk_view_unavailable",
  );
}
type RecordValue = {
  version: 1;
  generation: string;
  owner: string;
  tab_id: string;
  session_id: string;
  sequence: number;
  observed_at: number;
  expires_at: number;
  view: DeskView;
};
export function createDeskViewStore(
  location: () => string | undefined = () => process.env.PYTHIA_DESK_VIEW_STATE,
  now: () => number = Date.now,
  capacity = 256,
) {
  const generation = token();
  const records = new Map<string, RecordValue>();
  let directory: string | undefined;
  let initialized = false;
  let queue = Promise.resolve();
  async function checkRoot() {
    const configured = location();
    if (!configured || !isAbsolute(configured)) return unavailable();
    const root = resolve(configured);
    const workspace = process.env.PYTHIA_WORKSPACE;
    if (workspace) {
      const research = await realpath(workspace).catch(() =>
        resolve(workspace),
      );
      const within = relative(research, root);
      if (
        within === "" ||
        (within !== ".." && !within.startsWith("../") && !isAbsolute(within))
      )
        return unavailable();
    }
    if (directory && directory !== root) return unavailable();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (await realpath(root)) !== root
    )
      return unavailable();
    directory = root;
    return { root, stat };
  }
  async function write(name: string, value: unknown) {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > 16_384) return unavailable();
    const { root, stat } = await checkRoot();
    const temporary = join(root, `.${token()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(encoded);
      await handle.close();
      const current = await checkRoot();
      if (current.stat.ino !== stat.ino || current.stat.dev !== stat.dev)
        return unavailable();
      await rename(temporary, join(root, name));
    } finally {
      await handle.close();
      await unlink(temporary).catch(() => {});
    }
  }
  async function initialize() {
    if (!initialized) {
      const { root } = await checkRoot();
      const entries = await opendir(root);
      let scanned = 0;
      for await (const entry of entries) {
        if (++scanned > 1024) return unavailable();
        if (
          /^[A-Za-z0-9_-]{43}\.json$/u.test(entry.name) ||
          /^\.[A-Za-z0-9_-]{43}\.tmp$/u.test(entry.name)
        ) {
          await unlink(join(root, entry.name));
        }
      }
      await write("generation.json", { version: 1, generation });
      initialized = true;
    }
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  // Invalidate old process references at service startup, without making an
  // absent optional cache prevent ordinary Desk operation.
  const ready = serial(initialize).catch(() => {});
  async function sweep() {
    for (const [ref, record] of records) {
      if (record.expires_at <= now()) {
        records.delete(ref);
        if (directory)
          await unlink(join(directory, `${ref}.json`)).catch(() => {});
      }
    }
  }
  function owned(owner: string, tab: string, ref: string) {
    tabId(tab);
    viewReference(ref);
    const record = records.get(ref);
    if (
      !record ||
      record.owner !== ownerHash(owner) ||
      record.tab_id !== tab ||
      record.expires_at <= now()
    )
      return unavailable();
    return record;
  }
  return {
    ready,
    mint(owner: string, tab: string, sessionId: string, view: DeskView) {
      return serial(async () => {
        await initialize();
        await sweep();
        tabId(tab);
        if (
          !owner ||
          !sessionId ||
          sessionId.length > 512 ||
          /[\r\n\0]/u.test(sessionId) ||
          records.size >= capacity
        )
          return unavailable();
        const ref = token();
        const timestamp = now();
        const record: RecordValue = {
          version: 1,
          generation,
          owner: ownerHash(owner),
          tab_id: tab,
          session_id: sessionId,
          sequence: 0,
          observed_at: timestamp,
          expires_at: timestamp + DESK_VIEW_TTL_MS,
          view,
        };
        await write(`${ref}.json`, record);
        records.set(ref, record);
        return { view_reference: ref, expires_at: record.expires_at };
      });
    },
    publish(
      owner: string,
      tab: string,
      ref: string,
      sequence: number,
      view: DeskView,
    ) {
      return serial(async () => {
        const previous = owned(owner, tab, ref);
        if (!Number.isSafeInteger(sequence) || sequence <= previous.sequence)
          return unavailable();
        const timestamp = now();
        // Replacement (not merge) drops obsolete selection and page metadata.
        const record = {
          ...previous,
          sequence,
          observed_at: timestamp,
          expires_at: timestamp + DESK_VIEW_TTL_MS,
          view,
        };
        await write(`${ref}.json`, record);
        records.set(ref, record);
        return { expires_at: record.expires_at };
      });
    },
    terminate(owner: string, tab: string, ref: string) {
      return serial(async () => {
        owned(owner, tab, ref);
        const { root } = await checkRoot();
        await unlink(join(root, `${ref}.json`));
        records.delete(ref);
        return { available: false };
      });
    },
  };
}
export type DeskViewStore = ReturnType<typeof createDeskViewStore>;
export const deskViewStore = createDeskViewStore();
