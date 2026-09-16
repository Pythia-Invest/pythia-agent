import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createNativeSessionContextReader,
  createNativeSessionContextRoutes,
  parseNativeSessionContext,
} from "@/server/native-session-context";
import {
  parseStrategyScopeNotes,
  strategyScopeNote,
} from "@/workspace/session-context";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

// Result fields qualified by tooling/qualification/workspace-session-context.py
// against native SessionDB and its length-framed persisted prompt parser.
const reference = {
  version: 1 as const,
  originSessionId: "session-a",
  briefPath: "strategies/income/README.md",
};
const projection = {
  status: "ok",
  guidance: "current",
  firstInputEligible: false,
  scope: { status: "resolved", reference },
};

it("round-trips explicit scope notes and rejects escaping or malformed references", () => {
  const note = strategyScopeNote(reference);
  expect(
    parseStrategyScopeNotes(`Investor question\n${note}\nOther prose`),
  ).toEqual([reference]);
  expect(parseStrategyScopeNotes(`${note} trailing prose`)).toEqual([]);
  expect(() =>
    strategyScopeNote({ ...reference, briefPath: "strategies/../README.md" }),
  ).toThrow();
  expect(
    parseNativeSessionContext({
      ...projection,
      system_prompt: "private",
      transcript: "private",
    }),
  ).toEqual(projection);
  expect(
    parseNativeSessionContext({
      ...projection,
      scope: {
        status: "resolved",
        reference: { ...reference, nativePrompt: "private" },
      },
    }),
  ).toBeNull();
  expect(
    parseNativeSessionContext({ ...projection, firstInputEligible: true }),
  ).toBeNull();
});

it("admits the request before touching its session parameters or native reader", async () => {
  const reader = vi.fn();
  const context = {
    get params(): Promise<Record<string, string>> {
      throw new Error("Unadmitted parameter access");
    },
  };
  const response = await createNativeSessionContextRoutes(
    reader,
  ).sessionContext(
    new Request("http://outside.invalid/api/sessions/id/context"),
    context,
  );
  expect(response.status).toBe(403);
  expect(reader).not.toHaveBeenCalled();
});

async function fakeNative(body: string) {
  const root = await mkdtemp(join(tmpdir(), "pythia-session-reader-"));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  // A short-lived local process exercises the real spawn/stdio/termination
  // adapter. It is deliberately not presented as a native-contract oracle.
  const python = join(bin, "python");
  await writeFile(python, `#!${process.execPath}\n${body}\n`);
  await chmod(python, 0o700);
  return createNativeSessionContextReader({
    NODE_ENV: "test",
    HERMES_HOME: root,
    PYTHIA_HERMES_PROFILE: "synthetic",
    PYTHIA_HERMES_EXECUTABLE: join(bin, "hermes"),
    PYTHIA_MANAGED_ROOT: join(root, "managed"),
    PRIVATE_TEST_SECRET: "must-not-pass",
  });
}

it("projects a bounded subprocess result using only server-selected paths and environment", async () => {
  const read = await fakeNative(`
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      if (process.env.PRIVATE_TEST_SECRET || JSON.parse(input).sessionId !== "session-a") process.exit(9);
      process.stdout.write(${JSON.stringify(JSON.stringify({ ...projection, system_prompt: "not exposed" }))});
    });
  `);
  expect(await read("session-a")).toEqual(projection);
  expect((await read("../other-profile")).scope).toEqual({
    status: "unresolved",
    reason: "invalid_request",
  });
});

it("kills an oversized helper and a helper that exceeds its deadline", async () => {
  const oversized = await fakeNative(
    'process.stdout.write("x".repeat(9000)); setInterval(() => {}, 1000);',
  );
  expect((await oversized("session-a")).scope).toEqual({
    status: "unresolved",
    reason: "output_limit",
  });
  const hanging = await fakeNative(
    "process.stdin.resume(); setInterval(() => {}, 1000);",
  );
  expect((await hanging("session-a")).scope).toEqual({
    status: "unresolved",
    reason: "deadline",
  });
}, 5000);

it("does not launch for an already cancelled request or incomplete native configuration", async () => {
  const read = createNativeSessionContextReader({ NODE_ENV: "test" });
  expect((await read("session-a")).scope).toEqual({
    status: "unresolved",
    reason: "profile_unavailable",
  });
  const configured = await fakeNative("process.exit(9);");
  const controller = new AbortController();
  controller.abort();
  expect((await configured("session-a", controller.signal)).scope).toEqual({
    status: "unresolved",
    reason: "cancelled",
  });
});

// Qualification owner T2a: optional installed pinned source is an external
// resource, never a globally required Hermes installation for ordinary tests.
// Run this seat explicitly with PYTHIA_QUALIFICATION_HERMES_SOURCE after verifying its
// extraction digest using tooling/qualification/workspace-native.py.
const nativeSource = process.env.PYTHIA_QUALIFICATION_HERMES_SOURCE;
it.skipIf(!nativeSource)(
  "reads a real pinned native profile through the Desk subprocess adapter from unrelated cwd",
  async () => {
    const source = nativeSource as string;
    const root = await mkdtemp(join(tmpdir(), "pythia-desk-native-context-"));
    roots.push(root);
    const profile = join(root, "profiles", "synthetic");
    await mkdir(profile, { recursive: true });
    const repository = join(import.meta.dirname, "../../..");
    const receipt = JSON.parse(
      await readFile(join(source, ".pythia-source.json"), "utf8"),
    );
    const versions = JSON.parse(
      await readFile(join(repository, "runtime/versions.json"), "utf8"),
    );
    expect(receipt.commit).toBe(versions.dependencies.hermes_agent.commit);
    const python = join(source, ".venv/bin/python");
    await promisify(execFile)(
      python,
      [
        "-B",
        "-c",
        `
from pathlib import Path
from hermes_state import SessionDB
from hermes_cli.plugins import format_system_prompt_sections, RenderedPluginSystemPromptSection
db = SessionDB(db_path=Path(${JSON.stringify(join(profile, "state.db"))}))
try:
    db.create_session("session-a", source="api_server")
    db.create_session("untouched", source="api_server")
    section = RenderedPluginSystemPromptSection(id="pythia.operating", content="[PYTHIA_WORKSPACE_GUIDANCE_V1]", position="after_memory", plugin="pythia")
    db.update_system_prompt("session-a", format_system_prompt_sections([section]) + "\\n\\nConversation started: synthetic")
    db.append_message("session-a", "user", ${JSON.stringify(strategyScopeNote(reference))})
finally:
    db.close()
`,
      ],
      {
        cwd: root,
        env: {
          NODE_ENV: "test",
          HOME: root,
          HERMES_HOME: root,
          PATH: "/usr/bin:/bin",
          HERMES_DISABLE_LAZY_INSTALLS: "1",
        },
        timeout: 5000,
      },
    );
    const read = createNativeSessionContextReader({
      NODE_ENV: "test",
      HOME: root,
      HERMES_HOME: root,
      PYTHIA_HERMES_PROFILE: "synthetic",
      PYTHIA_HERMES_EXECUTABLE: join(source, ".venv/bin/hermes"),
      PYTHIA_MANAGED_ROOT: join(repository, "runtime/managed"),
    });
    expect(await read("session-a")).toEqual(projection);
    expect(await read("untouched")).toEqual({
      status: "ok",
      guidance: "unavailable",
      firstInputEligible: true,
      scope: { status: "none" },
    });
  },
  10_000,
);
