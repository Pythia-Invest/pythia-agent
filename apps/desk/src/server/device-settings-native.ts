import { execFile } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import {
  type CommandRunner,
  DeviceSettingsError,
  type DeviceSkill,
} from "./device-settings-contract";
import { privateDirectory } from "./device-settings-store";
import type { HermesSkill } from "./types";

const execFileAsync = promisify(execFile);
export const CAPABILITY_NAME = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const MANAGED_SKILL_NAMES = new Set([
  "eodhd-market-data",
  "investment-memory",
  "sec-edgar-research",
]);

export function safeIdentifier(value: string, label: string) {
  const normalized = value.trim();
  if (!CAPABILITY_NAME.test(normalized)) {
    throw new DeviceSettingsError(
      `A valid ${label} is required.`,
      400,
      "invalid_capability",
    );
  }
  return normalized;
}

function allowlistedEnvironment(
  environment: NodeJS.ProcessEnv,
  names: string[],
) {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = environment[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as NodeJS.ProcessEnv;
}

function commandEnvironment(environment: NodeJS.ProcessEnv) {
  return allowlistedEnvironment(environment, [
    "HOME",
    "HERMES_HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "PATH",
    "PYTHONIOENCODING",
    "TMPDIR",
    "TZ",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ]);
}

export function lifecycleCommandEnvironment(environment: NodeJS.ProcessEnv) {
  return allowlistedEnvironment(environment, [
    "DBUS_SESSION_BUS_ADDRESS",
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "PATH",
    "TMPDIR",
    "TZ",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
    "HERMES_HOME",
    "PYTHIA_CONFIG_ROOT",
    "PYTHIA_DEV_CACHE_HOME",
    "PYTHIA_DEV_CONFIG_HOME",
    "PYTHIA_DEV_DATA_HOME",
    "PYTHIA_DEV_LIFECYCLE_CLI",
    "PYTHIA_DEV_REPO_ROOT",
    "PYTHIA_DEV_STATE_HOME",
    "PYTHIA_HERMES_API_URL",
    "PYTHIA_HERMES_EXECUTABLE",
    "PYTHIA_HERMES_PROFILE",
    "PYTHIA_INSTALL_BIN_HOME",
    "PYTHIA_INSTALL_CACHE_HOME",
    "PYTHIA_INSTALL_CONFIG_HOME",
    "PYTHIA_INSTALL_DATA_HOME",
    "PYTHIA_INSTALL_STATE_HOME",
    "PYTHIA_INSTALL_SYSTEMD_HOME",
    "PYTHIA_LIFECYCLE_COMMAND",
    "PYTHIA_STATE_ROOT",
  ]);
}

export function nativeCommandRunner(
  environment: NodeJS.ProcessEnv,
): CommandRunner {
  const executable = environment.PYTHIA_HERMES_EXECUTABLE;
  if (!executable || !isAbsolute(executable)) {
    return async () => {
      throw new DeviceSettingsError(
        "The pinned Hermes command is unavailable.",
        503,
        "hermes_command_unavailable",
      );
    };
  }
  return async (args) => {
    try {
      const result = await execFileAsync(executable, args, {
        encoding: "utf8",
        env: commandEnvironment(environment),
        maxBuffer: 65_536,
        timeout: 30_000,
      });
      return { stdout: result.stdout };
    } catch {
      throw new DeviceSettingsError(
        "Hermes rejected the native settings change.",
        502,
        "hermes_command_failed",
      );
    }
  };
}

export function defaultRestart(
  environment: NodeJS.ProcessEnv,
  runner: typeof execFileAsync = execFileAsync,
) {
  const installedCommand = environment.PYTHIA_LIFECYCLE_COMMAND;
  if (installedCommand) {
    if (!isAbsolute(installedCommand)) {
      return async () => {
        throw new DeviceSettingsError(
          "The Pythia runtime restart owner is unavailable.",
          503,
          "runtime_restart_unavailable",
        );
      };
    }
    return async () => {
      try {
        await runner(installedCommand, ["restart-hermes"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: lifecycleCommandEnvironment(environment),
          maxBuffer: 65_536,
          timeout: 120_000,
        });
      } catch {
        throw new DeviceSettingsError(
          "Pythia could not restart its Hermes runtime.",
          503,
          "runtime_restart_failed",
        );
      }
    };
  }
  const cli = environment.PYTHIA_DEV_LIFECYCLE_CLI;
  if (!cli || !isAbsolute(cli)) {
    return async () => {
      throw new DeviceSettingsError(
        "The Pythia runtime restart owner is unavailable.",
        503,
        "runtime_restart_unavailable",
      );
    };
  }
  return async () => {
    try {
      await runner(process.execPath, [cli, "restart-hermes"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: lifecycleCommandEnvironment(environment),
        maxBuffer: 65_536,
        timeout: 120_000,
      });
    } catch {
      throw new DeviceSettingsError(
        "Pythia could not restart its Hermes runtime.",
        503,
        "runtime_restart_failed",
      );
    }
  };
}

export function parseDisabled(stdout: string) {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new DeviceSettingsError(
      "Hermes returned invalid global skill settings.",
      502,
      "skill_readback_invalid",
    );
  }
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== "string" || !CAPABILITY_NAME.test(entry),
    )
  ) {
    throw new DeviceSettingsError(
      "Hermes returned invalid global skill settings.",
      502,
      "skill_readback_invalid",
    );
  }
  return new Set(value);
}

export function skillRows(enabled: HermesSkill[], disabled: Set<string>) {
  const rows = new Map<string, DeviceSkill>();
  for (const item of enabled) {
    rows.set(item.name, {
      ...item,
      enabled: true,
      kind: MANAGED_SKILL_NAMES.has(item.name)
        ? "pythia-provided-name"
        : "other-hermes-skill",
      mutable: item.name !== "hermes-agent",
    });
  }
  for (const name of disabled) {
    if (!rows.has(name)) {
      rows.set(name, {
        name,
        enabled: false,
        kind: MANAGED_SKILL_NAMES.has(name)
          ? "pythia-provided-name"
          : "other-hermes-skill",
        mutable: name !== "hermes-agent",
      });
    }
  }
  return [...rows.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function removeDeadLock(path: string) {
  try {
    const lock = JSON.parse(readFileSync(path, "utf8")) as { pid?: unknown };
    if (!Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0) return false;
    try {
      process.kill(Number(lock.pid), 0);
      return false;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        return false;
      }
    }
    unlinkSync(path);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
  }
}

export async function withFileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  privateDirectory(dirname(path));
  const deadline = Date.now() + 15_000;
  let descriptor: number | undefined;
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(path, "wx", 0o600);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST" &&
        Date.now() < deadline
      ) {
        if (removeDeadLock(path)) continue;
        await sleep(25);
        continue;
      }
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new DeviceSettingsError(
          "Another capability change is still in progress.",
          409,
          "capability_mutation_busy",
        );
      }
      throw error;
    }
  }
  try {
    writeFileSync(
      descriptor,
      `${JSON.stringify({ owner, pid: process.pid, created_at: new Date().toISOString() })}\n`,
      "utf8",
    );
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    rmSync(path, { force: true });
    throw error;
  }
  try {
    return await operation();
  } finally {
    closeSync(descriptor);
    if (existsSync(path)) {
      try {
        const current = JSON.parse(readFileSync(path, "utf8")) as {
          owner?: unknown;
        };
        if (current.owner === owner) unlinkSync(path);
      } catch {
        // Never remove a lock whose ownership cannot be proven.
      }
    }
  }
}

export function profileFrom(environment: NodeJS.ProcessEnv, explicit?: string) {
  const profile = explicit ?? environment.PYTHIA_HERMES_PROFILE ?? "";
  if (!PROFILE_NAME.test(profile)) {
    throw new DeviceSettingsError(
      "The active Pythia Hermes profile is unavailable.",
      503,
      "hermes_profile_unavailable",
    );
  }
  return profile;
}
