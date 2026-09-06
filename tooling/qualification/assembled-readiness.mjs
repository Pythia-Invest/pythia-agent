import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export {
  runNativeContractProbe,
  SETTINGS_MUTATION_TIMEOUT_MS,
  verifyQualificationCache,
} from "./assembled-cache.mjs";
export {
  instrumentContextProbe,
  prepareAssembledFixture,
  qualificationCacheEnvironment,
} from "./assembled-fixture.mjs";
export {
  observeAssembledStack,
  requestJson,
  seedNativeSession,
} from "./assembled-observation.mjs";
export {
  cleanupAssembledFixture,
  disableSyntheticSkill,
  runAssembledCommand,
  seedSyntheticState,
} from "./assembled-operations.mjs";

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const { runAssembledReadinessCli } = await import("./assembled-cli.mjs");
  await runAssembledReadinessCli();
}
