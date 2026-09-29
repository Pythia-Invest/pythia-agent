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
function fixture(initial: unknown = {}, authenticated = true) {
  const root = mkdtempSync(join(tmpdir(), "pythia-first-model-"));
  roots.push(root);
  let stored = initial;
  const command = vi.fn(async (args: string[]) => {
    expect(args.slice(0, 2)).toEqual(["-p", "fixture"]);
    if (args[3] === "get") return { stdout: JSON.stringify(stored) };
    stored = {
      ...(stored as object),
      [args[4]?.split(".")[1] ?? "invalid"]: args[5],
    };
    return { stdout: "saved" };
  });
  const restartHermes = vi.fn(async () => {});
  const service = createDeviceSettingsService({
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
    } as HermesClient,
  });
  return { service, command, restartHermes };
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
