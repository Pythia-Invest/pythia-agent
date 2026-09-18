#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { build, formatMessages } from "esbuild";
import {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_ARTIFACT_MARKER,
} from "./src/artifact.mjs";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const managedRequire = createRequire(
  new URL("./package.json", import.meta.url),
);
const managedImport =
  /^(?:@pythia\/(?:widget-sdk|ui)(?:\/.*)?|react(?:\/.*)?|react-dom(?:\/.*)?)$/;

/** React and shared presentation always come from the selected managed checkout.
 * Other imports retain esbuild's normal resolution from the user's source tree. */
function managedImports() {
  return {
    name: "pythia-managed-imports",
    setup(builder) {
      builder.onResolve({ filter: managedImport }, async (args) => {
        if (args.pluginData?.managed) return undefined;
        return builder.resolve(args.path, {
          kind: args.kind,
          resolveDir: packageDirectory,
          pluginData: { managed: true },
        });
      });
    },
  };
}

// The frame intentionally has no font authority. Keep semantic font fallbacks
// without shipping dead font URLs or overriding the host's network policy.
function withoutFontFaces(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, "");
}

async function stylesheet(javascript, authoredCss) {
  const theme = withoutFontFaces(
    await readFile(managedRequire.resolve("@pythia/ui/styles.css"), "utf8"),
  );
  // Only managed CSS enters Tailwind's compiler. No user's plugin/config module
  // is loaded or executed; static authored CSS is bundled separately by esbuild.
  const compiler = await compile(
    `@import "tailwindcss" source(none);\n${theme}`,
    { base: packageDirectory, onDependency() {} },
  );
  const candidates = new Scanner({}).scanFiles([
    { content: javascript, extension: "js" },
  ]);
  return optimize(
    `${compiler.build(candidates)}\n${withoutFontFaces(authoredCss)}\nhtml{min-inline-size:0;background:transparent}body{margin:0;background:transparent}`,
    { minify: true, file: "widget.css" },
  ).code;
}

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
  if (extname(target).toLowerCase() !== ".html")
    throw new Error("The widget output must be an .html file.");
  const existingTarget = await realpath(target).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (source === target || source === existingTarget)
    throw new Error("The output cannot replace the component source.");

  const bundle = await build({
    stdin: {
      contents: `import Widget from ${JSON.stringify(source)};import {mountWidget} from "@pythia/widget-sdk";mountWidget(Widget);`,
      loader: "tsx",
      resolveDir: packageDirectory,
      sourcefile: "pythia-widget-entry.tsx",
    },
    bundle: true,
    write: false,
    metafile: true,
    outfile: "widget.js",
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    charset: "utf8",
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "inline",
    logLevel: "silent",
    loader: {
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".gif": "dataurl",
      ".webp": "dataurl",
      ".svg": "dataurl",
      ".woff": "dataurl",
      ".woff2": "dataurl",
    },
    plugins: [managedImports()],
  });
  if (bundle.warnings.some((warning) => warning.id === "empty-import-meta"))
    throw new Error(
      "Self-contained widgets cannot use import.meta. Import presentation from @pythia/widget-sdk; inline any required assets.",
    );
  for (const warning of await formatMessages(bundle.warnings, {
    kind: "warning",
    color: false,
  }))
    process.stderr.write(warning);
  if (
    Object.values(bundle.metafile.outputs).some((result) =>
      result.imports.some(
        (dependency) =>
          dependency.external &&
          !(
            dependency.kind === "url-token" &&
            dependency.path.startsWith("data:")
          ),
      ),
    )
  )
    throw new Error("A widget artifact cannot contain external imports.");
  const javascript = bundle.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )?.text;
  if (!javascript)
    throw new Error("The widget produced no browser JavaScript.");
  const authoredCss = bundle.outputFiles
    .filter((file) => file.path.endsWith(".css"))
    .map((file) => file.text)
    .join("\n");
  const css = await stylesheet(javascript, authoredCss);
  const html = `${WIDGET_ARTIFACT_MARKER}\n<style>${css.replace(/<\/style/gi, "<\\/style")}</style>\n<div id="pythia-widget-root"></div>\n<script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>\n`;
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes > MAX_WIDGET_ARTIFACT_BYTES)
    throw new Error(
      `Widget is ${bytes} bytes; the maximum is ${MAX_WIDGET_ARTIFACT_BYTES}. Reduce bundled dependencies or assets.`,
    );
  await atomicWrite(target, html);
  return {
    output: target,
    bytes,
    durationMs: Math.round(performance.now() - started),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [entry, output, ...extra] = process.argv.slice(2);
  if (!entry || !output || extra.length) {
    process.stderr.write(
      "Usage: pnpm widget:build <component.tsx> <widgets/name.html>\n",
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
