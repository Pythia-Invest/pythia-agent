import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DeviceSettingsError } from "./device-settings-contract";

export function privateDirectory(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new DeviceSettingsError(
      "The Pythia settings directory is not a private directory.",
      503,
      "settings_store_invalid",
    );
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new DeviceSettingsError(
      "The Pythia settings directory permissions are too open.",
      503,
      "settings_store_invalid",
    );
  }
}

export function resolveConfigRoot(environment: NodeJS.ProcessEnv) {
  const value = environment.PYTHIA_CONFIG_ROOT;
  if (value) return resolve(value);
  const hermesHome = environment.HERMES_HOME;
  if (hermesHome && isAbsolute(hermesHome)) return dirname(resolve(hermesHome));
  throw new DeviceSettingsError(
    "Pythia device settings are not configured for this runtime.",
    503,
    "settings_not_configured",
  );
}
