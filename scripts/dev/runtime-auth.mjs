import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { readJson, refreshManagedPlugin } from "./files.mjs";
import { redactedEnvironment } from "./environment.mjs";
import { run } from "./runtime-source.mjs";
import {
  hermesRun,
  nativeRootAuthArguments,
  runtimeCommands,
  secrets,
} from "./runtime-config.mjs";

const OAUTH_PROVIDERS = new Set([
  "anthropic",
  "nous",
  "openai-codex",
  "xai-oauth",
  "qwen-oauth",
  "minimax-oauth",
]);

export async function refreshRuntimeAssets(paths, apiKey) {
  refreshManagedPlugin(
    paths.managedPlugin,
    join(paths.profileRoot, "plugins", "pythia"),
  );
  hermesRun(
    paths,
    [
      "-p",
      paths.profile,
      "plugins",
      "doctor",
      join(paths.profileRoot, "plugins", "pythia"),
      "--ci",
    ],
    apiKey,
  );
}

export function readApiKey(paths) {
  return secrets(paths).hermes_api_key;
}

function initializedNativeHermes(paths) {
  if (!existsSync(paths.runtimeReceipt)) {
    throw new Error(
      "Pythia runtime tooling is not initialized. Run 'just dev-init' before using native Hermes authentication.",
    );
  }
  const receipt = readJson(paths.runtimeReceipt);
  if (
    receipt.schema_version !== 1 ||
    receipt.stack !== paths.id ||
    receipt.repository !== paths.repositoryRoot ||
    receipt.profile !== paths.profile ||
    receipt.hermes_root !== paths.hermesRoot ||
    receipt.state_root !== paths.stateRoot
  ) {
    throw new Error(
      `Refusing a runtime receipt that does not belong to this worktree: ${paths.runtimeReceipt}`,
    );
  }
  const hermes = runtimeCommands(paths).hermes;
  if (!existsSync(hermes)) {
    throw new Error(
      "Pythia runtime tooling is incomplete. Run 'just dev-init' before using native Hermes authentication.",
    );
  }
  const executable = lstatSync(hermes);
  if (!executable.isFile() || executable.isSymbolicLink()) {
    throw new Error(
      `Native Hermes executable is not a regular file: ${hermes}`,
    );
  }
  return hermes;
}

function nativeRootAuthRun(paths, action, provider, options = {}) {
  return run(
    initializedNativeHermes(paths),
    [
      "-p",
      "default",
      ...nativeRootAuthArguments(action, provider, options.type),
    ],
    {
      cwd: paths.repositoryRoot,
      env: {
        ...redactedEnvironment(process.env),
        HERMES_HOME: paths.hermesRoot,
      },
      interactive: options.interactive,
    },
  );
}

export async function authenticate(paths, provider, type = "oauth") {
  const normalized = String(provider ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.startsWith("-"))
    throw new Error("Provide a native Hermes provider name.");
  if (type === "oauth" && !OAUTH_PROVIDERS.has(normalized)) {
    const release = readJson(
      join(paths.repositoryRoot, "runtime", "versions.json"),
    ).dependencies.hermes_agent.package_version;
    throw new Error(
      `Hermes ${release} does not support native OAuth for '${normalized || "<missing>"}'. Supported providers: ${[...OAUTH_PROVIDERS].join(", ")}.`,
    );
  }
  nativeRootAuthRun(paths, "add", normalized, {
    interactive: true,
    type,
  });
}

export function configureSharedModel(paths) {
  return run(initializedNativeHermes(paths), ["-p", "default", "model"], {
    cwd: paths.repositoryRoot,
    env: { ...redactedEnvironment(process.env), HERMES_HOME: paths.hermesRoot },
    interactive: true,
  });
}

export async function authenticationStatus(paths, provider) {
  const normalized = String(provider ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.startsWith("-")) {
    throw new Error("Provide a native Hermes provider name.");
  }
  return nativeRootAuthRun(paths, "status", normalized);
}

export { OAUTH_PROVIDERS };
