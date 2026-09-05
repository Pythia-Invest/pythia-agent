#!/usr/bin/env node
import { existsSync } from "node:fs";
import {
  authenticate,
  authenticationStatus,
  configureSharedModel,
} from "./runtime.mjs";
import { resolveStackPaths } from "./paths.mjs";
import {
  initializeDevelopmentRuntime,
  recoverDevelopmentInitialization,
  resetDerivedDevelopmentState,
  requestHermesRestart,
  requestRuntimeRefresh,
  runDevelopment,
  stackStatus,
  stopStack,
} from "./supervisor.mjs";

function usage() {
  console.error(
    "Usage: node scripts/dev/cli.mjs <init|init-recover|dev|refresh|restart-hermes|status|stop|reset|auth|auth-status|model|paths> [provider] [oauth|api-key]",
  );
}

async function main() {
  const command = process.argv[2];
  const argument = process.argv[3];
  const paths = resolveStackPaths();
  switch (command) {
    case "init":
      await initializeDevelopmentRuntime(paths);
      console.log(
        `Initialized ${paths.id} with Hermes profile ${paths.profile}.`,
      );
      break;
    case "dev":
      await runDevelopment(paths);
      break;
    case "restart-hermes":
      console.log(JSON.stringify(await requestHermesRestart(paths), null, 2));
      break;
    case "refresh":
      console.log(JSON.stringify(await requestRuntimeRefresh(paths), null, 2));
      break;
    case "init-recover":
      console.log(
        JSON.stringify(await recoverDevelopmentInitialization(paths), null, 2),
      );
      break;
    case "status":
      console.log(JSON.stringify(stackStatus(paths), null, 2));
      break;
    case "stop":
      console.log(JSON.stringify(await stopStack(paths), null, 2));
      break;
    case "reset":
      console.log(JSON.stringify(resetDerivedDevelopmentState(paths), null, 2));
      break;
    case "auth":
      await authenticate(paths, argument, process.argv[4] ?? "oauth");
      break;
    case "model":
      configureSharedModel(paths);
      console.log(
        "Model selection finished. Restart an unconfigured stack with just stop and just dev to apply saved defaults. Existing model choices are preserved.",
      );
      break;
    case "auth-status":
      console.log(await authenticationStatus(paths, argument));
      break;
    case "paths":
      console.log(
        JSON.stringify(
          {
            stack: paths.id,
            repository: paths.repositoryRoot,
            profile: paths.profile,
            ports: paths.ports,
            workspace: paths.workspace,
            knowledge: paths.knowledge,
            state: paths.stateRoot,
            cache: paths.cacheRoot,
            hermes_root: paths.hermesRoot,
            profile_root: paths.profileRoot,
            basic_memory_config: paths.basicMemoryConfig,
            initialized: existsSync(paths.runtimeReceipt),
          },
          null,
          2,
        ),
      );
      break;
    default:
      usage();
      process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(`Pythia development error: ${error.message}`);
  process.exitCode = 1;
});
