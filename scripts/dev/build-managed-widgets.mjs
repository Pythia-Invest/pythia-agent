import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { buildWidget } from "../../packages/widget-sdk/build.mjs";
import {
  MANAGED_WIDGET_BUILDS,
  MANAGED_NODE_BUILDS,
} from "./managed-widget-builds.mjs";

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
  // The feature's headless SVG exporter ships as an explicit self-contained
  // Node asset, alongside its browser widget. No runtime package installation.
  const requireSdk = createRequire(
    resolve(repositoryRoot, "packages/widget-sdk/package.json"),
  );
  const { build } = requireSdk("esbuild");
  for (const definition of MANAGED_NODE_BUILDS) {
    const snapshot = await build({
      entryPoints: [resolve(repositoryRoot, definition.entry)],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      mainFields: ["module", "main"],
      nodePaths: [
        fileURLToPath(new URL("../../node_modules", import.meta.url)),
      ],
      external: ["canvas"],
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
      },
      minify: true,
      write: false,
    });
    const output = resolve(repositoryRoot, definition.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, snapshot.outputFiles[0].contents);
    results.push({
      output,
      bytes: snapshot.outputFiles[0].contents.byteLength,
    });
  }
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  for (const result of await buildManagedWidgets(repository))
    console.log(
      `Built managed asset ${result.output} (${result.bytes} bytes).`,
    );
}
