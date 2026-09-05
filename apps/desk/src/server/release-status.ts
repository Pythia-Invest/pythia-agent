import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DeskReleaseStatus = {
  status: "ready" | "unavailable";
  channel?: "stable" | "preview";
  current_version?: string;
  target_version?: string;
  update_available?: boolean;
  code?: string;
  message?: string;
};

export interface ReleaseStatusService {
  snapshot(): Promise<DeskReleaseStatus>;
}

function commandEnvironment(environment: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    [
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      "TMPDIR",
      "TZ",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "PYTHIA_INSTALL_CACHE_HOME",
      "PYTHIA_INSTALL_CONFIG_HOME",
      "PYTHIA_INSTALL_DATA_HOME",
      "PYTHIA_INSTALL_STATE_HOME",
    ].flatMap((name) =>
      environment[name] === undefined ? [] : [[name, environment[name]]],
    ),
  ) as NodeJS.ProcessEnv;
}

export function createReleaseStatusService(
  environment: NodeJS.ProcessEnv = process.env,
  command: typeof execFileAsync = execFileAsync,
): ReleaseStatusService {
  return {
    async snapshot() {
      const executable = environment.PYTHIA_LIFECYCLE_COMMAND;
      if (!executable || !isAbsolute(executable)) {
        return {
          status: "unavailable",
          code: "release_command_unavailable",
          message: "Update checks are available on an installed Pythia device.",
        };
      }
      try {
        const result = await command(executable, ["check-update", "--json"], {
          encoding: "utf8",
          env: commandEnvironment(environment),
          maxBuffer: 32_768,
          timeout: 60_000,
        });
        const raw = JSON.parse(result.stdout) as Record<string, unknown>;
        const status = raw.status === "ready" ? "ready" : "unavailable";
        return {
          status,
          ...(raw.channel === "stable" || raw.channel === "preview"
            ? { channel: raw.channel }
            : {}),
          ...(typeof raw.current_version === "string"
            ? { current_version: raw.current_version }
            : {}),
          ...(typeof raw.target_version === "string"
            ? { target_version: raw.target_version }
            : {}),
          ...(typeof raw.update_available === "boolean"
            ? { update_available: raw.update_available }
            : {}),
          ...(typeof raw.code === "string" ? { code: raw.code } : {}),
          ...(typeof raw.message === "string"
            ? { message: raw.message.slice(0, 320) }
            : {}),
        };
      } catch {
        return {
          status: "unavailable",
          code: "release_check_failed",
          message: "Pythia could not check for updates.",
        };
      }
    },
  };
}

export const releaseStatusService = createReleaseStatusService();
