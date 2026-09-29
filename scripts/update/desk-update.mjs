import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { readJsonIfPresent, transactionReceipt } from "../install/files.mjs";
import { systemctl } from "../install/systemd.mjs";
import {
  installedOwnership,
  fetchTarget,
  assertDescendant,
} from "./apply-state.mjs";
import { assertTargetPrerequisites } from "./target-prerequisites.mjs";
import { assertWorkspaceTransitionReady } from "./workspace-transition.mjs";
import {
  assertCleanCheckout,
  releaseStatus,
  ReleaseError,
  runGit,
  STABLE_TAG,
} from "./release.mjs";

export const UPDATE_UNIT = "pythia-agent-update.service";
const REVISION = /^[a-f0-9]{40,64}$/u;

function updaterState(query) {
  try {
    const state = query(
      ["show", UPDATE_UNIT, "--property=ActiveState", "--value"],
      { allowedStatuses: [0, 1, 4] },
    );
    if (["active", "activating", "deactivating", "reloading"].includes(state))
      return "running";
    return state === "failed"
      ? "failed"
      : state === "inactive"
        ? "idle"
        : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Local inventory only: opening Settings never contacts a release remote. */
export function installedUpdateStatus(paths, query = systemctl) {
  const installation = readJsonIfPresent(paths.installFile);
  const release = readJsonIfPresent(paths.releaseFile);
  if (!installation || !release || installation.checkout !== paths.checkout) {
    return {
      status: "unavailable",
      code: "not_installed",
      message:
        "This installation could not be identified. Run pythia doctor on the host.",
    };
  }
  const receipt = transactionReceipt(paths).value;
  const updater = updaterState(query);
  let version = release.channel === "preview" ? "main" : "Stable";
  if (release.channel === "stable") {
    try {
      const tags = runGit(paths.checkout, [
        "tag",
        "--points-at",
        installation.revision,
      ])
        .split("\n")
        .filter((tag) => STABLE_TAG.test(tag));
      if (tags.length === 1) version = tags[0];
    } catch {
      /* Build identity remains available without a local tag. */
    }
  }
  return {
    status: "ready",
    channel: release.channel,
    current_version: version,
    current_revision: installation.revision,
    installed_at: installation.updated_at,
    apply_supported: updater !== "unavailable",
    updater,
    ...(receipt?.operation === "update"
      ? {
          last_update: {
            phase: receipt.phase,
            target_revision: receipt.new_revision,
          },
        }
      : {}),
  };
}

function updateEnvironment(paths, environment) {
  return {
    HOME: environment.HOME ?? "",
    PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    PYTHIA_INSTALL_CONFIG_HOME: dirname(paths.configRoot),
    PYTHIA_INSTALL_STATE_HOME: dirname(paths.stateRoot),
    PYTHIA_INSTALL_DATA_HOME: dirname(paths.dataRoot),
    PYTHIA_INSTALL_CACHE_HOME: dirname(paths.cacheRoot),
    PYTHIA_INSTALL_BIN_HOME: paths.binRoot,
    PYTHIA_INSTALL_SYSTEMD_HOME: paths.unitRoot,
  };
}

/** A fixed systemd handoff keeps the existing updater alive when it stops Desk. */
export function startDeskUpdate(paths, expected, hooks = {}) {
  const query = hooks.systemctl ?? systemctl;
  const execute = hooks.spawnSync ?? spawnSync;
  try {
    if (!REVISION.test(expected.current) || !REVISION.test(expected.target)) {
      throw new ReleaseError(
        "Check for updates again before installing.",
        "invalid_update_target",
      );
    }
    const state = updaterState(query);
    if (state === "running")
      throw new ReleaseError(
        "An application update is already running.",
        "update_running",
      );
    if (state === "unavailable")
      throw new ReleaseError(
        "The user service manager is unavailable. Run pythia update on the host.",
        "update_service_unavailable",
      );
    try {
      assertWorkspaceTransitionReady(paths);
    } catch (error) {
      throw new ReleaseError(
        error instanceof Error
          ? error.message
          : "Workspace transition required.",
        "workspace_transition_required",
      );
    }
    const checkout = assertCleanCheckout(paths.checkout);
    installedOwnership(paths, checkout.head);
    const receipt = transactionReceipt(paths).value;
    if (
      receipt &&
      !["complete", "failed-before-stop"].includes(receipt.phase)
    ) {
      throw new ReleaseError(
        "An earlier operation needs recovery. Run pythia status on the host.",
        "recovery_required",
      );
    }
    const release = (hooks.releaseStatus ?? releaseStatus)(paths);
    if (release.status !== "ready")
      throw new ReleaseError(release.message, release.code);
    if (
      release.current_revision !== expected.current ||
      release.target_revision !== expected.target
    )
      throw new ReleaseError(
        "The available build changed. Check for updates again.",
        "release_changed",
      );
    if (!release.update_available)
      throw new ReleaseError(
        "Pythia is already up to date.",
        "already_current",
      );
    const target = fetchTarget(paths, release);
    assertDescendant(paths, checkout.head, target);
    assertTargetPrerequisites(paths, release.target_revision);
    if (state === "failed") query(["reset-failed", UPDATE_UNIT]);
    const environment = updateEnvironment(
      paths,
      hooks.environment ?? process.env,
    );
    const result = execute(
      "systemd-run",
      [
        "--user",
        `--unit=${UPDATE_UNIT}`,
        "--property=Type=exec",
        "--description=Pythia application update",
        ...Object.entries(environment).map(
          ([key, value]) => `--setenv=${key}=${value}`,
        ),
        "--",
        paths.installedCommand,
        "update",
        "--expect-current",
        expected.current,
        "--expect-target",
        expected.target,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
    );
    if (result.error || result.status !== 0)
      throw new ReleaseError(
        "The update could not start. Check the user service manager on the host.",
        "update_start_failed",
      );
    return { started: true, target_revision: expected.target };
  } catch (error) {
    return {
      started: false,
      code: error instanceof ReleaseError ? error.code : "update_start_failed",
      message:
        error instanceof ReleaseError
          ? error.message
          : "The update could not start. Run pythia doctor on the host.",
    };
  }
}
