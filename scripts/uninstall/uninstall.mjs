import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { writeTransaction } from "../install/files.mjs";
import {
  removeUnits,
  serviceAction,
  systemctl,
  UNIT_NAMES,
} from "../install/systemd.mjs";

const SAFE_UNIT_STATES = new Set(["absent", "inactive"]);
const SAFE_ENABLEMENT_STATES = new Set(["absent", "disabled", "not-found"]);

function runSystemctl(args) {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return String(result.stdout ?? "").trim();
}

function inspectUnit(name) {
  const output = runSystemctl([
    "show",
    name,
    "--property=LoadState",
    "--property=ActiveState",
  ]);
  const properties = Object.fromEntries(
    output
      .split("\n")
      .map((line) => line.split("=", 2))
      .filter(([key, value]) => key && value),
  );
  if (properties.LoadState === "not-found") return "absent";
  if (properties.ActiveState === "inactive") return "inactive";
  return properties.ActiveState ?? "unconfirmed";
}

function inspectEnablement(name) {
  return runSystemctl(["is-enabled", name]) || "unconfirmed";
}

function ownedUnitStates(inspector) {
  const states = {};
  for (const name of UNIT_NAMES) {
    try {
      states[name] = inspector(name);
    } catch {
      states[name] = "unconfirmed";
    }
  }
  return states;
}

function failClosed(paths, purge, code, message, services, detail = {}) {
  const receipt = writeTransaction(paths, {
    transaction_id: `uninstall-${Date.now()}-${process.pid}`,
    operation: "uninstall",
    phase: "failed-stopped",
    services,
    purge_requested: purge,
    error_code: code,
    error_message: message,
    ...detail,
  });
  const error = new Error(message);
  error.code = code;
  error.receipt = receipt;
  throw error;
}

function safeRemove(path, expectedParent, expectedName) {
  const target = resolve(path);
  if (
    dirname(target) !== resolve(expectedParent) ||
    basename(target) !== expectedName
  ) {
    throw new Error(`Refusing to remove unexpected path: ${target}`);
  }
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink()) {
    throw new Error(`Refusing to remove symlinked Pythia path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

export function uninstall(paths, { purge = false, actions = {} } = {}) {
  const stop = actions.stop ?? (() => serviceAction("stop"));
  const disable =
    actions.disable ?? (() => systemctl(["disable", "pythia-agent.target"]));
  const unitState = actions.unitState ?? inspectUnit;
  const enablement = actions.enablement ?? inspectEnablement;
  const removeManagedUnits = actions.removeUnits ?? (() => removeUnits(paths));
  const reload = actions.reload ?? (() => systemctl(["daemon-reload"]));
  try {
    stop();
  } catch {
    // Readback below distinguishes an idempotent stop from an operational failure.
  }
  const unitStates = ownedUnitStates(unitState);
  if (Object.values(unitStates).some((state) => !SAFE_UNIT_STATES.has(state))) {
    failClosed(
      paths,
      purge,
      "uninstall_stop_unconfirmed",
      "Pythia could not confirm that every owned unit is inactive; nothing was removed.",
      "stop-unconfirmed",
      { unit_states: unitStates },
    );
  }
  try {
    disable();
  } catch {
    // Readback below accepts only an explicitly disabled or absent target.
  }
  let enablementState = "unconfirmed";
  try {
    enablementState = enablement("pythia-agent.target");
  } catch {
    // The failure receipt below must retain ownership artifacts.
  }
  if (!SAFE_ENABLEMENT_STATES.has(enablementState)) {
    failClosed(
      paths,
      purge,
      "uninstall_disable_unconfirmed",
      "Pythia could not confirm that its target is disabled; nothing was removed.",
      "stopped",
      { unit_states: unitStates, target_enablement: enablementState },
    );
  }
  removeManagedUnits();
  reload();
  safeRemove(paths.installedCommand, paths.binRoot, "pythia");
  safeRemove(paths.runtimeRoot, paths.dataRoot, "runtime");
  if (existsSync(paths.installFile)) rmSync(paths.installFile);
  if (existsSync(paths.runtimeReceipt)) rmSync(paths.runtimeReceipt);
  const retained = [paths.checkout, paths.workspace, paths.knowledge];
  if (purge) {
    safeRemove(paths.configRoot, dirname(paths.configRoot), "pythia");
    safeRemove(paths.stateRoot, dirname(paths.stateRoot), "pythia");
    safeRemove(paths.cacheRoot, dirname(paths.cacheRoot), "pythia");
  } else {
    retained.push(paths.configRoot, paths.stateRoot);
  }
  return {
    uninstalled: true,
    services: "stopped",
    purged_device_configuration: purge,
    retained,
    knowledge_deleted: false,
    linger_unchanged: true,
  };
}
