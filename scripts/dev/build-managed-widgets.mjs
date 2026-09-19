import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildWidget } from "../../packages/widget-sdk/build.mjs";
import { MANAGED_WIDGET_BUILDS } from "./managed-widget-builds.mjs";

// Explicit release inputs, not runtime discovery. The copied source remains
// editable; compiled artifacts are refreshed only during selected-source builds.
export async function buildManagedWidgets(repositoryRoot) {
  const results = [];
  for (const { entry, output } of MANAGED_WIDGET_BUILDS)
    results.push(
      await buildWidget(
        resolve(repositoryRoot, entry),
        resolve(repositoryRoot, output),
      ),
    );
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  for (const result of await buildManagedWidgets(repository))
    console.log(
      `Built managed widget ${result.output} (${result.bytes} bytes).`,
    );
}
