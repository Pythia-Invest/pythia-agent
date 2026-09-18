import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { WIDGET_ARTIFACT_MARKER } from "../src/artifact.mjs";
import { bundleWidget } from "./browser.mjs";

const managedImport =
  /^(?:@pythia\/(?:widget-sdk|ui)(?:\/.*)?|react(?:\/.*)?|react-dom(?:\/.*)?)$/;

function managedImports(packageDirectory) {
  return {
    name: "pythia-legacy-managed-imports",
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

// Legacy frames retain their own theme with system-font fallbacks. Their CSP
// gives no external font/network authority; this mode does not reuse Desk CSS.
function withoutFontFaces(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, "");
}

/** Explicit .html compatibility target, retaining the original isolated-frame
 * compiler. Only this path bundles React/UI and mounts a separate frame root. */
export async function legacyArtifact(source, packageDirectory) {
  const { javascript, authoredCss } = await bundleWidget(
    `import Widget from ${JSON.stringify(source)};import {mountWidget} from "@pythia/widget-sdk";mountWidget(Widget);`,
    packageDirectory,
    [managedImports(packageDirectory)],
  );
  const managedRequire = createRequire(join(packageDirectory, "package.json"));
  const theme = withoutFontFaces(
    await readFile(managedRequire.resolve("@pythia/ui/styles.css"), "utf8"),
  );
  // No author Tailwind plugin/config module is loaded. Authored CSS stays static
  // and is appended after the managed compiler's output, as in the legacy SDK.
  const compiler = await compile(
    `@import "tailwindcss" source(none);\n${theme}`,
    { base: packageDirectory, onDependency() {} },
  );
  const candidates = new Scanner({}).scanFiles([
    { content: javascript, extension: "js" },
  ]);
  const css = optimize(
    `${compiler.build(candidates)}\n${withoutFontFaces(authoredCss)}\nhtml{min-inline-size:0;background:transparent}body{margin:0;background:transparent}`,
    { minify: true, file: "widget.css" },
  ).code;
  return `${WIDGET_ARTIFACT_MARKER}\n<style>${css.replace(/<\/style/gi, "<\\/style")}</style>\n<div id="pythia-widget-root"></div>\n<script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>\n`;
}
