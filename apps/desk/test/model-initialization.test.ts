import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeviceSettingsService } from "@/server/device-settings";
import type { HermesClient } from "@/server/types";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(
  initial: unknown = {},
  authenticated = true,
  run: { status: string; error?: string } = { status: "completed" },
) {
  const root = mkdtempSync(join(tmpdir(), "pythia-first-model-"));
  roots.push(root);
  let stored = initial;
  const command = vi.fn(async (args: string[]) => {
    expect(args.slice(0, 2)).toEqual(["-p", "fixture"]);
    if (args[3] === "get") return { stdout: JSON.stringify(stored) };
    if (args[3] === "unset") {
      const field = args[4]?.split(".")[1] ?? "invalid";
      stored = Object.fromEntries(
        Object.entries(stored as object).filter(([key]) => key !== field),
      );
      return { stdout: "unset" };
    }
    stored = {
      ...(stored as object),
      [args[4]?.split(".")[1] ?? "invalid"]: args[5],
    };
    return { stdout: "saved" };
  });
  const restartHermes = vi.fn(async () => {});
  const service = createDeviceSettingsService({
    firstRunPollMs: 0,
    configRoot: root,
    environment: { NODE_ENV: "test" },
    profile: "fixture",
    command,
    restartHermes,
    client: {
      modelOptions: async () => ({
        providers: [
          { slug: "example", authenticated, models: [{ id: "model-one" }] },
        ],
      }),
      getRun: async (run_id: string) => ({ run_id, ...run }),
    } as HermesClient,
  });
  return { service, command, restartHermes, stored: () => stored };
}
const selection = { provider: "example", model: "model-one" };
it.each([{}, "", null])(
  "initializes only this empty profile and restarts before returning, once under concurrency: %j",
  async (initial) => {
    const f = fixture(initial);
    await Promise.all([
      f.service.initializeModel(selection),
      f.service.initializeModel(selection),
    ]);
    expect(
      f.command.mock.calls
        .filter(([args]) => args[3] === "set")
        .map(([args]) => args.slice(4)),
    ).toEqual([
      ["model.provider", "example"],
      ["model.default", "model-one"],
    ]);
    expect(f.restartHermes).toHaveBeenCalledTimes(1);
  },
);
it.each([
  { provider: "existing" },
  { default: "existing" },
  { base_url: "https://example.test" },
  "legacy",
  { provider: "existing", default: "model" },
])("preserves existing or partial native choices: %j", async (initial) => {
  const f = fixture(initial);
  await f.service.initializeModel(selection);
  expect(f.command).toHaveBeenCalledTimes(1);
  expect(f.restartHermes).not.toHaveBeenCalled();
});
it("does not persist an unauthenticated selection", async () => {
  const f = fixture({}, false);
  await expect(f.service.initializeModel(selection)).rejects.toMatchObject({
    code: "model_auth_missing",
  });
  expect(f.command).toHaveBeenCalledTimes(1);
  expect(f.restartHermes).not.toHaveBeenCalled();
});
it("does not start successfully if native readback or restart fails", async () => {
  const f = fixture();
  f.restartHermes.mockRejectedValueOnce(new Error("restart failed"));
  await expect(f.service.initializeModel(selection)).rejects.toThrow(
    "restart failed",
  );
});
const saved = { provider: "example", default: "model-one" };
const authFailure = {
  status: "failed",
  error:
    "⚠️ Provider authentication failed: No Anthropic credentials found. Set ANTHROPIC_TOKEN or ANTHROPIC_API_KEY.",
};
it.each([
  ["a credential failure", authFailure, "r-1", {}],
  ["a run that never started", { status: "completed" }, null, {}],
  [
    "a network error",
    { status: "failed", error: "ConnectError: connection reset" },
    "r-1",
    saved,
  ],
  ["a completed run", { status: "completed" }, "r-1", saved],
])(
  "clears a first-send model only after %s",
  async (_label, run, runId, expected) => {
    const f = fixture({}, true, run);
    expect(await f.service.initializeModel(selection)).toBe(true);
    await f.service.settleInitialModel(selection, runId);
    expect(f.stored()).toEqual(expected);
    expect(f.restartHermes).toHaveBeenCalledTimes(
      Object.keys(expected).length ? 1 : 2,
    );
  },
);
it("leaves a choice changed since the first send alone", async () => {
  const f = fixture({}, true, authFailure);
  expect(await f.service.initializeModel(selection)).toBe(true);
  await f.command([
    "-p",
    "fixture",
    "config",
    "set",
    "model.default",
    "model-two",
  ]);
  await f.service.settleInitialModel(selection, "r-1");
  expect(f.stored()).toEqual({ provider: "example", default: "model-two" });
  expect(f.restartHermes).toHaveBeenCalledTimes(1);
});
