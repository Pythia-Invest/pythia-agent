import {
  assertWorkspaceTransitionReady,
  assertStagedWorkspaceTransition,
  workspaceTransitionStatus,
} from "../update/workspace-transition.mjs";
import { existsSync, lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, ensurePrivateTree, readJson } from "./files.mjs";
import { redactedEnvironment, runtimeEnvironment } from "./environment.mjs";
import { refreshManagedPlugins } from "./managed-plugins.mjs";
import {
  assertHermesRuntimePath,
  developmentPrivateRoots,
  ensureHermesSource,
  run,
  validateToolchain,
} from "./runtime-source.mjs";
import {
  configureFreshProfile,
  ensureNativeWorkspaceCwd,
  hermesRun,
  inheritModelDefaults,
  installSeeds,
  runtimeCommands,
  secrets,
} from "./runtime-config.mjs";

export async function prepareManagedRuntime(paths, options = {}) {
  assertWorkspaceTransitionReady(paths);
  const sourceContract =
    options.sourceContract ??
    readJson(
      join(paths.repositoryRoot, "runtime", "hermes", "hermes-source.json"),
    );
  const prepareHermesSource = options.ensureHermesSource ?? ensureHermesSource;
  const execute = options.runCommand ?? run;
  const environment =
    options.environment ??
    redactedEnvironment(options.sourceEnvironment ?? process.env);
  await prepareHermesSource(paths, sourceContract);

  const [hermesUv, ...hermesUvArguments] = sourceContract.install.command;
  if (hermesUv !== "uv" || hermesUvArguments.length === 0) {
    throw new Error(
      "Hermes source contract contains an unsupported install command.",
    );
  }
  execute(hermesUv, hermesUvArguments, {
    cwd: paths.hermesSource,
    env: { ...environment, UV_PYTHON: "3.12.11" },
  });
  execute("pnpm", ["install", "--frozen-lockfile"], {
    cwd: paths.repositoryRoot,
    env: environment,
  });
  execute("pnpm", runtimeCommands(paths).managedRunnerBuild, {
    cwd: paths.repositoryRoot,
    env: environment,
  });
  return { sourceContract, environment };
}

function initializationReceipt(paths) {
  if (!existsSync(paths.profileInitialization)) return null;
  const receipt = readJson(paths.profileInitialization);
  if (
    receipt.schema_version !== 1 ||
    receipt.stack !== paths.id ||
    receipt.repository !== paths.repositoryRoot ||
    receipt.profile !== paths.profile ||
    receipt.hermes_root !== paths.hermesRoot ||
    receipt.state_root !== paths.stateRoot ||
    receipt.profile_initially_absent !== true
  ) {
    throw new Error(
      `Refusing a profile-initialization receipt that does not belong to this worktree: ${paths.profileInitialization}`,
    );
  }
  return receipt;
}

function writeInitializationReceipt(paths, status) {
  atomicWriteJson(paths.profileInitialization, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    profile: paths.profile,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    profile_initially_absent: true,
    status,
    ...(status === "complete"
      ? { workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]" }
      : {}),
    updated_at: new Date().toISOString(),
  });
}

export function recoverInterruptedProfileInitialization(paths, options = {}) {
  const receipt = initializationReceipt(paths);
  if (!receipt || receipt.status === "complete") {
    throw new Error(
      "There is no interrupted Pythia profile initialization to recover.",
    );
  }
  if (existsSync(paths.receipt)) {
    throw new Error(
      `Refusing initialization recovery while a foreground receipt exists: ${paths.receipt}`,
    );
  }
  if (receipt.status === "started" && existsSync(paths.profileRoot)) {
    throw new Error(
      `The initialization receipt proves only that Pythia intended to create ${paths.profileRoot}; the existing profile's ownership is ambiguous. Refusing to delete it. Inspect the profile and receipt manually before retrying.`,
    );
  }
  if (
    receipt.status !== "started" &&
    receipt.status !== "native-profile-created" &&
    receipt.status !== "seeds-installed"
  ) {
    throw new Error(
      `Unknown profile-initialization status '${receipt.status}'; refusing recovery.`,
    );
  }
  if (existsSync(paths.profileRoot)) {
    const info = lstatSync(paths.profileRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(
        `Interrupted profile target is not a real directory: ${paths.profileRoot}`,
      );
    }
    rmSync(paths.profileRoot, { recursive: true, force: true });
  }
  rmSync(paths.profileInitialization);
  return {
    recovered: true,
    removed_profile: paths.profileRoot,
    preserved_credential_root: paths.hermesRoot,
    next: options.next ?? "just dev-init",
  };
}

export async function bootstrapRuntime(paths, options = {}) {
  if (
    options.allowStagedTransition &&
    workspaceTransitionStatus(paths) === "staged"
  ) {
    assertStagedWorkspaceTransition(paths);
    if (!existsSync(join(paths.configRoot, "secrets.json")))
      throw new Error(
        "The staged stack secret store is missing; startup will not recreate it.",
      );
    return {
      commands: runtimeCommands(paths),
      environment: runtimeEnvironment(paths, secrets(paths).hermes_api_key),
      transition: "staged",
    };
  }
  assertWorkspaceTransitionReady(paths);
  validateToolchain(paths.repositoryRoot);
  assertHermesRuntimePath(paths);
  ensurePrivateTree(developmentPrivateRoots(paths));
  const values = secrets(paths);
  const commands = runtimeCommands(paths);
  const { sourceContract } = await prepareManagedRuntime(paths);

  let initialization = initializationReceipt(paths);
  if (initialization && initialization.status !== "complete") {
    if (!existsSync(paths.profileRoot) && initialization.status === "started") {
      rmSync(paths.profileInitialization);
      initialization = null;
    } else {
      throw new Error(
        `Pythia profile initialization was interrupted at '${initialization.status}'. The partial profile is not adopted or preserved. Inspect the receipt, then run '${options.initializationRecoveryCommand ?? "just dev-init-recover"}' to remove only that transaction-owned profile before retrying.`,
      );
    }
  }
  let freshProfile = false;
  if (!existsSync(paths.profileRoot)) {
    if (initialization?.status === "complete") {
      throw new Error(
        `The completed initialization receipt points to a missing profile: ${paths.profileRoot}. Refusing to recreate it implicitly.`,
      );
    }
    writeInitializationReceipt(paths, "started");
    hermesRun(paths, commands.profileCreate, values.hermes_api_key);
    writeInitializationReceipt(paths, "native-profile-created");
    freshProfile = true;
  } else if (initialization?.status !== "complete") {
    throw new Error(
      `Refusing to adopt an existing non-Pythia Hermes profile at ${paths.profileRoot}.`,
    );
  } else if (
    !existsSync(join(paths.profileRoot, "config.yaml")) ||
    !existsSync(join(paths.profileRoot, ".no-bundled-skills"))
  ) {
    throw new Error(
      `Pythia Hermes profile is incomplete at ${paths.profileRoot}.`,
    );
  }
  if (freshProfile) {
    installSeeds(paths, { freshProfile: true });
    writeInitializationReceipt(paths, "seeds-installed");
    configureFreshProfile(paths, values.hermes_api_key);
  } else {
    ensureNativeWorkspaceCwd(paths, values.hermes_api_key);
  }
  if (options.inheritSharedModel !== false)
    inheritModelDefaults(paths, values.hermes_api_key);
  refreshManagedPlugins(paths, values.hermes_api_key, { freshProfile });
  const environment = runtimeEnvironment(paths, values.hermes_api_key);
  if (freshProfile) writeInitializationReceipt(paths, "complete");
  atomicWriteJson(paths.runtimeReceipt, {
    schema_version: 1,
    stack: paths.id,
    repository: paths.repositoryRoot,
    profile: paths.profile,
    hermes_root: paths.hermesRoot,
    state_root: paths.stateRoot,
    hermes: sourceContract,
    workspace_guidance: "[PYTHIA_WORKSPACE_GUIDANCE_V1]",
    initialized_at: new Date().toISOString(),
  });
  return { commands, environment };
}
