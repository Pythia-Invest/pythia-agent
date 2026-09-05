import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  DeviceSettingsError,
  type Readiness,
} from "./device-settings-contract";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
type JsonStore = Record<string, unknown> & { schema_version?: unknown };

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

function privateFile(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink()) return false;
  return process.platform === "win32" || (info.mode & 0o077) === 0;
}

function readStore(path: string): JsonStore | null {
  if (!existsSync(path)) return { schema_version: 1 };
  if (!privateFile(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return null;
    const store = value as JsonStore;
    return store.schema_version === 1 ? store : null;
  } catch {
    return null;
  }
}

export function requireStore(path: string) {
  const store = readStore(path);
  if (store === null) {
    throw new DeviceSettingsError(
      "The existing Pythia settings file is invalid; it was not changed.",
      503,
      "settings_store_invalid",
    );
  }
  return store;
}

export function atomicWriteStore(path: string, value: JsonStore) {
  privateDirectory(dirname(path));
  const temporary = join(
    dirname(path),
    `.pythia-settings-${process.pid}-${Date.now()}`,
  );
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify({ ...value, schema_version: 1 }, null, 2)}\n`,
      "utf8",
    );
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(temporary, 0o600);
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function secIdentityStatus(value: unknown): Readiness {
  if (value === undefined || value === null || value === "") return "missing";
  if (typeof value !== "string") return "invalid";
  const parts = value.trim().split(/\s+/u);
  const email = parts.at(-1) ?? "";
  return parts.length >= 2 && EMAIL.test(email) && value.length <= 320
    ? "configured"
    : "invalid";
}

export function tokenStatus(value: unknown): Readiness {
  if (value === undefined || value === null || value === "") return "missing";
  return typeof value === "string" &&
    value.length <= 512 &&
    !/\s/u.test(value) &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
    ? "configured"
    : "invalid";
}

export function settingsReadiness(
  path: string,
  field: string,
  secret: boolean,
) {
  const store = readStore(path);
  if (store === null) return "invalid" as const;
  return secret ? tokenStatus(store[field]) : secIdentityStatus(store[field]);
}

export function resolveConfigRoot(
  environment: NodeJS.ProcessEnv,
  explicit?: string,
) {
  const value = explicit ?? environment.PYTHIA_CONFIG_ROOT;
  if (value) return resolve(value);
  const hermesHome = environment.HERMES_HOME;
  if (hermesHome && isAbsolute(hermesHome)) return dirname(resolve(hermesHome));
  throw new DeviceSettingsError(
    "Pythia device settings are not configured for this runtime.",
    503,
    "settings_not_configured",
  );
}
