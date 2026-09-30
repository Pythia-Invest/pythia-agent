// Dependency-free, read-only target-release handshake. No service, provider,
// configuration, preparation, migration or installation writes are allowed here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MANAGED_CORE_FILES } from "../dev/files.mjs";
import { assertManagedPluginCopy } from "../dev/plugin-copy.mjs";
import { assertWorkspaceTransitionReady } from "./workspace-transition-state.mjs";

try {
  const paths = JSON.parse(readFileSync(0, "utf8"));
  assertWorkspaceTransitionReady(paths);
  assertManagedPluginCopy(
    fileURLToPath(new URL("../../runtime/managed/core/", import.meta.url)),
    join(paths.profileRoot, "plugins", "pythia"),
    MANAGED_CORE_FILES,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Prerequisite check failed.",
  );
  process.exitCode = 1;
}
