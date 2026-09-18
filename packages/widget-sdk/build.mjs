#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleWidget } from "./compiler/browser.mjs";
import { legacyArtifact } from "./compiler/legacy.mjs";
import {
  requiredImports,
  runtimeImports,
} from "./compiler/runtime-imports.mjs";
import { compileStyles, scopeStyles } from "./compiler/styles.mjs";
import {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_MODULE_MARKER,
  WIDGET_RUNTIME_VERSION,
  WIDGET_SDK_VERSION,
} from "./src/artifact.mjs";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
async function atomicWrite(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

/** Explicit local compilation. Never imported by Desk or invoked on refresh. */
export async function buildWidget(entry, output) {
  const started = performance.now();
  const source = await realpath(resolve(entry));
  const target = resolve(output);
  if (!(await stat(source)).isFile() || !/\.[cm]?[jt]sx?$/.test(source))
    throw new Error("Choose a JavaScript or TypeScript React component file.");
  if (![".mjs", ".html"].includes(extname(target).toLowerCase()))
    throw new Error(
      "Choose an .mjs module output, or an .html output for explicit legacy iframe compatibility.",
    );
  const existingTarget = await realpath(target).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (source === target || source === existingTarget)
    throw new Error("The output cannot replace the component source.");

  const artifact =
    extname(target).toLowerCase() === ".html"
      ? await legacyArtifact(source, packageDirectory)
      : await moduleArtifact(source);
  const bytes = Buffer.byteLength(artifact, "utf8");
  if (bytes > MAX_WIDGET_ARTIFACT_BYTES)
    throw new Error(
      `Widget is ${bytes} bytes; the maximum is ${MAX_WIDGET_ARTIFACT_BYTES}. Reduce bundled dependencies or assets.`,
    );
  await atomicWrite(target, artifact);
  return {
    output: target,
    bytes,
    durationMs: Math.round(performance.now() - started),
  };
}

async function moduleArtifact(source) {
  const { javascript, authoredCss, metafile } = await bundleWidget(
    `export {default} from ${JSON.stringify(source)};export * from ${JSON.stringify(source)};`,
    packageDirectory,
    [runtimeImports()],
    "__pythiaWidget",
  );
  const styles = await compileStyles(javascript, authoredCss, packageDirectory);
  const imports = requiredImports(metafile);
  const identity = createHash("sha256")
    .update(
      JSON.stringify([javascript, styles, imports, WIDGET_RUNTIME_VERSION]),
    )
    .digest("hex")
    .slice(0, 24);
  const scope = `pyw-${identity}`;
  const css = scopeStyles(styles, scope);
  const metadata = {
    format: "pythia-widget-module",
    version: 1,
    runtimeVersion: WIDGET_RUNTIME_VERSION,
    reactMajor: 19,
    sdkVersion: WIDGET_SDK_VERSION,
    scope,
    imports,
  };
  // Static ESM exports remain inert on import. The host validates metadata and
  // every required binding before invoking this factory in its React tree.
  return `${WIDGET_MODULE_MARKER}\nexport const metadata=${JSON.stringify(metadata)};\nexport const css=${JSON.stringify(css)};\nexport function createWidget(__pythiaHost){\n${javascript}\nreturn {Component:__pythiaWidget.default,binding:__pythiaWidget.binding};\n}\n`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [entry, output, ...extra] = process.argv.slice(2);
  if (!entry || !output || extra.length) {
    process.stderr.write(
      "Usage: pnpm widget:build <component.tsx> <widgets/name.mjs|widgets/name.html>\n",
    );
    process.exitCode = 1;
  } else {
    try {
      const result = await buildWidget(entry, output);
      process.stdout.write(
        `Built ${result.output} (${result.bytes} bytes, ${result.durationMs} ms)\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Widget build failed."}\n`,
      );
      process.exitCode = 1;
    }
  }
}
