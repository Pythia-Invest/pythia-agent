import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  writeFile,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { createDeskViewStore } from "@/server/view-context/store";
import { createDeskViewRoutes } from "@/server/view-context/routes";
import { validateView } from "@/server/view-context/validation";
import { createWorkspaceStore } from "@/server/workspace/store";
const roots: string[] = [];
const owner = "o".repeat(43),
  tab = "a".repeat(16),
  otherTab = "b".repeat(16);
const view = {
  route: "/workspace/report.md",
  title: "Research",
  file: { path: "report.md", selection: "Evidence" },
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(capacity = 256) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "pythia-desk-view-")),
  );
  roots.push(root);
  const state = join(root, "view-state");
  let now = Date.now();
  const store = createDeskViewStore(
    () => state,
    () => now,
    capacity,
  );
  await store.ready;
  await writeFile(join(root, "report.md"), "# Research\nEvidence");
  const workspace = createWorkspaceStore(() => root);
  return {
    root,
    state,
    store,
    routes: createDeskViewRoutes(store, workspace),
    workspace,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function request(value: unknown, csrf = owner) {
  return new Request("http://localhost:43121/api/desk-view/publish", {
    method: "POST",
    headers: {
      host: "localhost:43121",
      origin: "http://localhost:43121",
      "content-type": "application/json",
      cookie: `pythia_desk_session=${owner}`,
      "x-pythia-csrf": csrf,
    },
    body: JSON.stringify(value),
  });
}
async function nativeRead(
  state: string,
  reference: string,
  session = "native-session",
) {
  const source = process.env.PYTHIA_QUALIFICATION_HERMES_SOURCE;
  const python = source ? join(source, ".venv/bin/python") : "python3";
  const args = [
    resolve("../../tooling/qualification/workspace-view.py"),
    "--state",
    state,
    `--reference=${reference}`,
    `--session=${session}`,
  ];
  if (source) args.push("--hermes-source", source);
  const { stdout } = await promisify(execFile)(python, args, {
    timeout: 20_000,
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
    },
  });
  return JSON.parse(stdout);
}
it("carries two separate tabs through actual serialized records to the plugin, refuses another native session", async () => {
  const f = await fixture();
  const a = await f.store.mint(
    owner,
    tab,
    "native-session",
    await validateView(
      { ...view, file: { ...view.file, hostPath: "/untrusted" } },
      f.workspace,
    ),
  );
  const b = await f.store.mint(owner, otherTab, "native-session", {
    route: "/",
    title: "New chat",
  });
  const first = await nativeRead(f.state, a.view_reference);
  expect(first.view.file.selection).toBe("Evidence");
  expect(first.view.file.hostPath).toBe(join(f.root, "report.md"));
  expect((await nativeRead(f.state, b.view_reference)).view.title).toBe(
    "New chat",
  );
  expect(await nativeRead(f.state, a.view_reference, "other-session")).toEqual({
    available: false,
    reason: "different_session",
  });
  expect(
    await readFile(join(f.state, `${a.view_reference}.json`), "utf8"),
  ).not.toContain(owner);
});
it("enforces admission, owner/tab binding, monotonic updates, replacement and terminal removal", async () => {
  const f = await fixture();
  const { view_reference } = await f.store.mint(
    owner,
    tab,
    "native-session",
    view,
  );
  const update = {
    tab_id: tab,
    view_reference,
    sequence: 1,
    view: { route: "/", title: "New chat", password: "not copied" },
  };
  expect(
    (await f.routes.publishDeskView(request(update, "wrong"))).status,
  ).toBe(403);
  expect(
    (await f.routes.publishDeskView(request({ ...update, tab_id: otherTab })))
      .status,
  ).toBe(503);
  expect((await f.routes.publishDeskView(request(update))).status).toBe(200);
  expect((await f.routes.publishDeskView(request(update))).status).toBe(503);
  const stored = JSON.parse(
    await readFile(join(f.state, `${view_reference}.json`), "utf8"),
  );
  expect(stored.view).toEqual({ route: "/", title: "New chat" });
  expect(
    (await f.routes.terminateDeskView(request({ tab_id: tab, view_reference })))
      .status,
  ).toBe(200);
  expect((await nativeRead(f.state, view_reference)).available).toBe(false);
});
it("expires without revival, bounds capacity and invalidates prior process references", async () => {
  const f = await fixture(1);
  const first = await f.store.mint(owner, tab, "native-session", view);
  await expect(
    f.store.mint(owner, otherTab, "native-session", view),
  ).rejects.toThrow("unavailable");
  f.advance(60_000);
  await expect(
    f.store.publish(owner, tab, first.view_reference, 1, view),
  ).rejects.toThrow("unavailable");
  const next = await f.store.mint(owner, otherTab, "native-session", view);
  const restarted = createDeskViewStore(() => f.state);
  await restarted.ready;
  expect((await nativeRead(f.state, next.view_reference)).available).toBe(
    false,
  );
});
it("rejects unsafe cache roots and corrupt, oversized or non-private records", async () => {
  const f = await fixture();
  const { view_reference } = await f.store.mint(
    owner,
    tab,
    "native-session",
    view,
  );
  const file = join(f.state, `${view_reference}.json`);
  await chmod(file, 0o644);
  expect((await nativeRead(f.state, view_reference)).available).toBe(false);
  await chmod(file, 0o600);
  await writeFile(file, "x".repeat(20_000));
  expect((await nativeRead(f.state, view_reference)).available).toBe(false);
  await writeFile(file, "{");
  expect((await nativeRead(f.state, view_reference)).available).toBe(false);
  const linked = join(f.root, "linked");
  await symlink(f.state, linked);
  const unsafe = createDeskViewStore(() => linked);
  await unsafe.ready;
  await expect(unsafe.mint(owner, tab, "native-session", view)).rejects.toThrow(
    "unavailable",
  );
  await chmod(f.state, 0o755);
  expect((await nativeRead(f.state, view_reference)).available).toBe(false);
});
it("bounds request bytes without trusting Content-Length and suppresses settings/form state", async () => {
  const f = await fixture();
  expect(
    await validateView(
      {
        route: "/settings/providers",
        title: "secret",
        file: { path: "secret" },
      },
      f.workspace,
    ),
  ).toEqual({ route: "/settings", title: "Settings" });
  await expect(
    validateView({ route: "/?token=secret", title: "Page" }, f.workspace),
  ).rejects.toThrow();
  await expect(
    validateView({ ...view, file: { path: "../outside" } }, f.workspace),
  ).rejects.toThrow();
  expect(
    (await f.routes.publishDeskView(request({ padding: "x".repeat(20_000) })))
      .status,
  ).toBe(413);
});
it("refuses a view-cache location inside user research before creating it", async () => {
  const f = await fixture();
  const previous = process.env.PYTHIA_WORKSPACE;
  process.env.PYTHIA_WORKSPACE = f.root;
  try {
    const unsafe = createDeskViewStore(() => join(f.root, "..cache"));
    await unsafe.ready;
    await expect(
      unsafe.mint(owner, tab, "native-session", view),
    ).rejects.toThrow("unavailable");
    await expect(
      readFile(join(f.root, "..cache", "generation.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previous === undefined) delete process.env.PYTHIA_WORKSPACE;
    else process.env.PYTHIA_WORKSPACE = previous;
  }
});
