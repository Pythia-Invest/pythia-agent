import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runNativeContractProbe,
  verifyQualificationCache,
} from "./assembled-cache.mjs";
import {
  instrumentContextProbe,
  prepareAssembledFixture,
} from "./assembled-fixture.mjs";
import {
  observeAssembledStack,
  seedNativeSession,
} from "./assembled-observation.mjs";
import {
  cleanupAssembledFixture,
  disableSyntheticSkill,
  seedSyntheticState,
} from "./assembled-operations.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function runAssembledReadinessCli() {
  const action = process.argv[2];
  const root = option("--root");
  const stack = option("--stack") ?? "one";
  const cacheInputPath = option("--cache-input");
  const explicitCache = cacheInputPath
    ? JSON.parse(readFileSync(resolve(cacheInputPath), "utf8"))
    : null;
  let result;
  if (action === "verify-cache") {
    if (!explicitCache)
      throw new Error("verify-cache requires --cache-input PATH.");
    result = {
      cache: verifyQualificationCache(explicitCache),
      native: runNativeContractProbe(explicitCache),
    };
  } else if (action === "prepare" && root) {
    if (explicitCache) runNativeContractProbe(explicitCache);
    result = prepareAssembledFixture(root, { cacheInput: explicitCache });
  } else if (action === "instrument-context-probe" && root) {
    result = instrumentContextProbe(root, stack);
  } else if (action === "seed-state" && root) {
    result = seedSyntheticState(root, stack);
  } else if (action === "seed-native-session" && root) {
    result = seedNativeSession(root, stack);
  } else if (action === "disable-skill" && root) {
    result = await disableSyntheticSkill(root, stack);
  } else if (action === "observe" && root) {
    result = await observeAssembledStack(root, stack);
  } else if (action === "cleanup" && root) {
    result = cleanupAssembledFixture(root);
  } else {
    throw new Error(
      "Usage: assembled-readiness.mjs <verify-cache|prepare|instrument-context-probe|seed-state|seed-native-session|disable-skill|observe|cleanup> [--root PATH] [--stack one|two] [--cache-input PATH]",
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
