#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { doctor } from "../doctor/doctor.mjs";
import { uninstall } from "../uninstall/uninstall.mjs";
import { applyUpdate, recoverUpdate } from "../update/apply.mjs";
import { releaseStatus } from "../update/release.mjs";
import { readJsonIfPresent, transactionReceipt } from "./files.mjs";
import { resolveInstallPaths, publicPathSummary } from "./paths.mjs";
import {
  installDevice,
  installedExecutables,
  prepareInstallation,
  rebuildDevice,
  startAndVerify,
} from "./runtime.mjs";
import { serviceAction, systemctl } from "./systemd.mjs";
import { recoverInterruptedProfileInitialization } from "../dev/runtime.mjs";

function usage() {
  console.log(`Usage: pythia <command>

  status                 Show installed channel, revision, and service state
  doctor                 Check local runtime, ownership, health, and capabilities
  check-update [--json]  Report update availability without applying it
  update                 Apply one verified fast-forward update
  rebuild                Activate the current local checkout without changing Git
  recover                Resume an interrupted update and keep services stopped on failure
  start | stop           Start or stop the Pythia user services
  restart-hermes         Restart only the owned Hermes user service
  auth <provider>        Run native Hermes OAuth setup
  auth-status <provider> Show native redacted Hermes OAuth status
  paths                  Show Pythia-owned local paths and ports
  uninstall [--purge]    Remove Pythia; retain user data by default`);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function serviceState() {
  try {
    return systemctl(["is-active", "pythia-agent.target"]);
  } catch {
    return "inactive";
  }
}

function installationStatus(paths) {
  const installation = readJsonIfPresent(paths.installFile);
  const release = readJsonIfPresent(paths.releaseFile);
  return {
    installed: Boolean(installation),
    channel: release?.channel ?? "unknown",
    revision: installation?.revision ?? null,
    checkout: installation?.checkout ?? paths.checkout,
    services: serviceState(),
    transaction: transactionReceipt(paths).value,
    desk_url: `http://127.0.0.1:${paths.ports.desk}`,
  };
}

function nativeAuth(paths, provider, statusOnly) {
  const supported = new Set([
    "anthropic",
    "nous",
    "openai-codex",
    "xai-oauth",
    "qwen-oauth",
    "minimax-oauth",
  ]);
  if (!provider || !supported.has(provider)) {
    throw new Error(
      `Unsupported native OAuth provider '${provider || "<missing>"}'. Supported: ${[...supported].join(", ")}.`,
    );
  }
  const executable = installedExecutables(paths).hermes;
  const args = statusOnly
    ? ["auth", "status", provider]
    : ["auth", "add", "--type", "oauth", provider];
  const result = spawnSync(executable, args, {
    cwd: paths.checkout,
    env: { ...process.env, HERMES_HOME: paths.hermesRoot },
    stdio: statusOnly ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    timeout: statusOnly ? 30_000 : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error("Native Hermes authentication failed.");
  if (statusOnly) process.stdout.write(String(result.stdout));
}

async function install(paths) {
  const channel = option("--channel");
  const expectedRevision = option("--revision");
  if (!channel || !expectedRevision) {
    throw new Error(
      "Internal install channel and verified revision are required.",
    );
  }
  print(await installDevice(paths, channel, { expectedRevision }));
}

export function recoverInstalledInitialization(paths, channel) {
  if (!["stable", "preview"].includes(channel)) {
    throw new Error(
      "Installed initialization recovery requires stable or preview.",
    );
  }
  const preview = channel === "preview" ? " --preview" : "";
  return recoverInterruptedProfileInitialization(paths, {
    next: `./install.sh${preview}`,
  });
}

async function completeUpdate(paths) {
  const transactionId = option("--transaction");
  const receipt = transactionReceipt(paths).value;
  if (
    !transactionId ||
    !receipt ||
    receipt.transaction_id !== transactionId ||
    receipt.operation !== "update" ||
    !["source-updated", "failed-stopped", "prepared"].includes(receipt.phase)
  ) {
    throw new Error(
      "The update completion receipt is missing or does not match.",
    );
  }
  const prepared = await prepareInstallation(
    paths,
    receipt.channel,
    receipt.new_revision,
  );
  if (prepared.revision !== receipt.new_revision) {
    throw new Error("The prepared checkout does not match the update receipt.");
  }
}

async function restartHermes(paths) {
  serviceAction("restart-hermes");
  const secrets = readJsonIfPresent(join(paths.configRoot, "secrets.json"));
  const bearer = secrets?.hermes_api_key;
  if (typeof bearer !== "string" || bearer.length < 16) {
    throw new Error("The Hermes API bearer is missing or invalid.");
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${paths.ports.hermes}/health`,
        {
          headers: { Authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (response.ok) return print({ restarted: "hermes", ready: true });
    } catch {
      // A bounded restart window is expected.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Hermes did not become ready after restart.");
}

async function main() {
  const command = process.argv[2] ?? "help";
  const paths = resolveInstallPaths();
  switch (command) {
    case "install":
      await install(paths);
      break;
    case "recover-initialization":
      print(recoverInstalledInitialization(paths, option("--channel")));
      break;
    case "complete-update":
      await completeUpdate(paths);
      break;
    case "check-update": {
      const status = releaseStatus(paths);
      if (process.argv.includes("--json")) print(status);
      else if (status.status === "ready") {
        console.log(
          status.update_available
            ? `${status.target_version} is available on the ${status.channel} channel.`
            : `Pythia is current on the ${status.channel} channel.`,
        );
      } else console.log(`Update check unavailable: ${status.message}`);
      break;
    }
    case "update":
      print(await applyUpdate(paths));
      break;
    case "rebuild":
      print(await rebuildDevice(paths));
      break;
    case "recover":
      print(await recoverUpdate(paths));
      break;
    case "start":
      await startAndVerify(paths);
      print({
        started: true,
        desk_url: `http://127.0.0.1:${paths.ports.desk}`,
      });
      break;
    case "stop":
      serviceAction("stop");
      print({ stopped: true });
      break;
    case "restart-hermes":
      await restartHermes(paths);
      break;
    case "status":
      print(installationStatus(paths));
      break;
    case "doctor":
      print(await doctor(paths));
      break;
    case "paths":
      print(publicPathSummary(paths));
      break;
    case "auth":
      nativeAuth(paths, process.argv[3], false);
      break;
    case "auth-status":
      nativeAuth(paths, process.argv[3], true);
      break;
    case "uninstall":
      print(uninstall(paths, { purge: process.argv.includes("--purge") }));
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

export function lifecycleFailureGuidance(command, receipt) {
  if (command === "rebuild") {
    if (receipt?.services === "stopped") {
      return "Services remain stopped. Inspect 'pythia status' and 'pythia doctor', fix the cause, then rerun 'pythia rebuild'.";
    }
    if (receipt?.services === "stop-unconfirmed") {
      return "Pythia could not confirm that every service stopped. Inspect 'pythia status' before rerunning 'pythia rebuild'.";
    }
    return "The rebuild was refused before Pythia stopped services or activated local source.";
  }
  if (command === "install") {
    if (receipt?.services === "stopped") {
      return "Services remain stopped. Inspect 'pythia status' and 'pythia doctor', then rerun the originating './install.sh' command.";
    }
    if (receipt?.services === "stop-unconfirmed") {
      return "Pythia could not confirm that every service stopped. Inspect 'pythia status' before rerunning the originating './install.sh' command.";
    }
    return "The install was refused before Pythia activated the selected source. Rerun the originating './install.sh' command after correcting the reported cause.";
  }
  if (["update", "recover"].includes(command)) {
    if (receipt?.services === "stopped") {
      return "Services remain stopped. Inspect 'pythia status', then retry 'pythia recover'. Start manually only after 'pythia doctor' passes.";
    }
    if (receipt?.services === "stop-unconfirmed") {
      return "Pythia could not confirm that every service stopped. Inspect 'pythia status' before recovery.";
    }
    return "The update was refused before Pythia stopped services or changed source.";
  }
  return null;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`Pythia lifecycle error: ${error.message}`);
    const paths = resolveInstallPaths();
    const receipt = transactionReceipt(paths).value;
    const guidance = lifecycleFailureGuidance(process.argv[2] ?? "", receipt);
    if (guidance) console.error(guidance);
    process.exitCode = 1;
  });
}
