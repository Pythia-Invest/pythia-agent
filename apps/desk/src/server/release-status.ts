import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { HermesApiError } from "./hermes-records";

const execFileAsync = promisify(execFile);
const REVISION = /^[a-f0-9]{40,64}$/u;

export type DeskReleaseStatus = {
  status: "ready" | "unavailable";
  channel?: "stable" | "preview";
  current_version?: string;
  current_revision?: string;
  target_version?: string;
  target_revision?: string;
  update_available?: boolean;
  checkout_clean?: boolean;
  apply_supported?: boolean;
  updater?: "running" | "idle" | "failed" | "unavailable";
  last_update?: { phase: string; target_revision?: string };
  code?: string;
  message?: string;
};
export type UpdateTarget = { current: string; target: string };
export type UpdateStarted = { started: true; target_revision: string };

export interface ReleaseStatusService {
  snapshot(check?: boolean): Promise<DeskReleaseStatus>;
  start(expected: UpdateTarget): Promise<UpdateStarted>;
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
      "XDG_RUNTIME_DIR",
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "PYTHIA_INSTALL_CACHE_HOME",
      "PYTHIA_INSTALL_CONFIG_HOME",
      "PYTHIA_INSTALL_DATA_HOME",
      "PYTHIA_INSTALL_STATE_HOME",
      "PYTHIA_INSTALL_BIN_HOME",
      "PYTHIA_INSTALL_SYSTEMD_HOME",
    ].flatMap((name) =>
      environment[name] === undefined ? [] : [[name, environment[name]]],
    ),
  ) as NodeJS.ProcessEnv;
}

function project(raw: Record<string, unknown>): DeskReleaseStatus {
  const value: DeskReleaseStatus = {
    status: raw.status === "ready" ? "ready" : "unavailable",
  };
  if (raw.channel === "stable" || raw.channel === "preview")
    value.channel = raw.channel;
  for (const key of [
    "current_version",
    "target_version",
    "code",
    "message",
  ] as const)
    if (typeof raw[key] === "string") value[key] = raw[key].slice(0, 320);
  for (const key of ["current_revision", "target_revision"] as const)
    if (typeof raw[key] === "string" && REVISION.test(raw[key]))
      value[key] = raw[key];
  for (const key of [
    "update_available",
    "checkout_clean",
    "apply_supported",
  ] as const)
    if (typeof raw[key] === "boolean") value[key] = raw[key];
  if (
    ["running", "idle", "failed", "unavailable"].includes(String(raw.updater))
  )
    value.updater = raw.updater as NonNullable<DeskReleaseStatus["updater"]>;
  if (raw.last_update && typeof raw.last_update === "object") {
    const receipt = raw.last_update as Record<string, unknown>;
    if (typeof receipt.phase === "string")
      value.last_update = {
        phase: receipt.phase.slice(0, 80),
        ...(typeof receipt.target_revision === "string" &&
        REVISION.test(receipt.target_revision)
          ? { target_revision: receipt.target_revision }
          : {}),
      };
  }
  return value;
}

export function createReleaseStatusService(
  environment: NodeJS.ProcessEnv = process.env,
  command: typeof execFileAsync = execFileAsync,
): ReleaseStatusService {
  const executable = environment.PYTHIA_LIFECYCLE_COMMAND;
  const installed = Boolean(executable && isAbsolute(executable));
  const invoke = async (args: string[]) => {
    if (!executable || !isAbsolute(executable))
      throw new Error("Missing lifecycle command");
    const result = await command(executable, args, {
      encoding: "utf8",
      env: commandEnvironment(environment),
      maxBuffer: 32_768,
      timeout: 75_000,
    });
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };
  return {
    async snapshot(check = false) {
      if (!installed) {
        let revision: string | undefined;
        if (environment.NODE_ENV === "development") {
          try {
            const result = await command(
              "git",
              ["rev-parse", "--verify", "HEAD"],
              {
                encoding: "utf8",
                env: commandEnvironment(environment),
                timeout: 2_000,
                maxBuffer: 256,
              },
            );
            const candidate = result.stdout.trim();
            if (REVISION.test(candidate)) revision = candidate;
          } catch {
            /* An exported development tree may have no Git metadata. */
          }
        }
        return {
          status: "unavailable",
          ...(environment.NODE_ENV === "development"
            ? { current_version: "Development" }
            : {}),
          ...(revision ? { current_revision: revision } : {}),
          apply_supported: false,
          code: "release_command_unavailable",
          message:
            "Application updates are available on an installed Pythia device. This development workspace updates from source.",
        };
      }
      let local: DeskReleaseStatus = { status: "unavailable" };
      try {
        local = project(await invoke(["update-status", "--json"]));
        if (!check) return local;
        const checked = project(await invoke(["check-update", "--json"]));
        // The activated receipt identifies the running build, even when discovery fails.
        return {
          ...local,
          ...checked,
          ...(local.current_version
            ? { current_version: local.current_version }
            : {}),
          ...(local.current_revision
            ? { current_revision: local.current_revision }
            : {}),
          apply_supported:
            local.apply_supported === true &&
            checked.current_revision === local.current_revision,
        };
      } catch {
        return {
          ...local,
          status: "unavailable",
          code: "release_check_failed",
          message:
            "Pythia could not read its update status. Try again, or run pythia doctor on the host.",
        };
      }
    },
    async start(expected) {
      if (!installed)
        throw new HermesApiError(
          "Updates are available on an installed Pythia device.",
          409,
          "update_unavailable",
        );
      if (!REVISION.test(expected.current) || !REVISION.test(expected.target))
        throw new HermesApiError(
          "Check for updates before installing a build.",
          400,
          "invalid_update_target",
        );
      let raw: Record<string, unknown>;
      try {
        raw = await invoke([
          "start-update",
          "--expect-current",
          expected.current,
          "--expect-target",
          expected.target,
        ]);
      } catch {
        throw new HermesApiError(
          "Could not confirm whether the update started. Refresh its status before trying again.",
          503,
          "update_start_unconfirmed",
        );
      }
      if (raw.started !== true || raw.target_revision !== expected.target) {
        throw new HermesApiError(
          typeof raw.message === "string"
            ? raw.message.slice(0, 320)
            : "The update could not start. Check for updates again.",
          409,
          typeof raw.code === "string"
            ? raw.code.slice(0, 80)
            : "update_start_failed",
        );
      }
      return { started: true, target_revision: expected.target };
    },
  };
}

export const releaseStatusService = createReleaseStatusService();
