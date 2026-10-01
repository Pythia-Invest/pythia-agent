import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeviceSettingsService } from "@/server/device-settings";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

function harness() {
  const configRoot = mkdtempSync(join(tmpdir(), "pythia-pause-"));
  roots.push(configRoot);
  chmodSync(configRoot, 0o700);
  const command = vi.fn(async () => ({ stdout: "" }));
  const restartHermes = vi.fn(async () => {});
  const service = createDeviceSettingsService({
    command,
    environment: {
      NODE_ENV: "test",
      PYTHIA_CONFIG_ROOT: configRoot,
      PYTHIA_STATE_ROOT: join(configRoot, "state"),
    },
    restartHermes,
  });
  mkdirSync(join(configRoot, "state"), { mode: 0o700, recursive: true });
  return { command, configRoot, restartHermes, service };
}

it("pauses and resumes a data source in settings.json with no command and no restart", async () => {
  if (process.platform === "win32") return;
  const { command, configRoot, restartHermes, service } = harness();
  const path = join(configRoot, "settings.json");
  const stored = () => JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, '{"schema_version":1,"sec_identity":"Name a@b.c"}\n', {
    mode: 0o600,
  });
  await expect(
    service.setPluginPaused("pythia-openfigi", true),
  ).resolves.toEqual({ plugin: "pythia-openfigi", paused: true });
  await service.setPluginPaused("pythia-defillama", true);
  await service.setPluginPaused("pythia-openfigi", true); // twice is once
  expect(stored()).toEqual({
    schema_version: 1,
    sec_identity: "Name a@b.c", // every other field is kept
    pythia_paused_plugins: ["pythia-defillama", "pythia-openfigi"],
  });
  expect(statSync(path).mode & 0o077).toBe(0);
  await service.setPluginPaused("pythia-openfigi", false);
  expect(stored().pythia_paused_plugins).toEqual(["pythia-defillama"]);
  expect([command.mock.calls.length, restartHermes.mock.calls.length]).toEqual([
    0, 0,
  ]);
  await expect(service.setPluginPaused("Bad Name", true)).rejects.toMatchObject(
    {
      code: "invalid_capability",
    },
  );
});

it("creates settings.json on the first pause and never rewrites an unsafe one", async () => {
  if (process.platform === "win32") return;
  const { configRoot, service } = harness();
  const path = join(configRoot, "settings.json");
  await service.setPluginPaused("pythia-nsm", true);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    schema_version: 1,
    pythia_paused_plugins: ["pythia-nsm"],
  });
  writeFileSync(path, '{"schema_version":1,"sec_identity":"EXISTING"}\n');
  chmodSync(path, 0o644);
  await expect(
    service.setPluginPaused("pythia-nsm", false),
  ).rejects.toMatchObject({ code: "settings_store_invalid" });
  expect(readFileSync(path, "utf8")).toContain("EXISTING");
});
