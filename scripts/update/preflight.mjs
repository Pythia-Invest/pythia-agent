#!/usr/bin/env node
// Compatibility entry point for running a reviewed newer release's preflight
// against an older installation, without activating the newer source.
import { resolveInstallPaths } from "../install/paths.mjs";
import { assertCleanCheckout, discoverRelease } from "./release.mjs";
import {
  assertDescendant,
  fetchTarget,
  installedOwnership,
} from "./apply-state.mjs";
import { assertTargetPrerequisites } from "./target-prerequisites.mjs";

try {
  if (process.argv.length !== 4 || process.argv[2] !== "--checkout")
    throw new Error(
      "Usage: node scripts/update/preflight.mjs --checkout <installed-checkout>",
    );
  const paths = resolveInstallPaths({
    ...process.env,
    PYTHIA_CHECKOUT: process.argv[3],
  });
  const before = assertCleanCheckout(paths.checkout);
  installedOwnership(paths, before.head);
  const release = discoverRelease(paths);
  if (release.update_available) {
    const target = fetchTarget(paths, release);
    assertDescendant(paths, before.head, target);
    assertTargetPrerequisites(paths, release.target_revision);
  }
  console.log(
    JSON.stringify({
      target: release.target_revision,
      ready: true,
      services_changed: false,
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Update preflight failed.",
  );
  process.exitCode = 1;
}
