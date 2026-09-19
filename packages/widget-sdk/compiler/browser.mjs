import { resolve } from "node:path";
import { build, formatMessages } from "esbuild";
import { runtimeImports } from "./runtime-imports.mjs";

/** Static browser compilation with explicit bindings to the host runtime. */
export async function bundleWidget(source, packageDirectory) {
  const bundle = await build({
    stdin: {
      contents: `export {default} from ${JSON.stringify(source)};export * from ${JSON.stringify(source)};`,
      loader: "tsx",
      resolveDir: packageDirectory,
      sourcefile: "pythia-widget-entry.tsx",
    },
    bundle: true,
    // Author-local dependencies take precedence. Public feature packages already
    // installed by this checkout's frozen build remain available to copied
    // compositions outside the checkout as a normal resolver fallback.
    nodePaths: [resolve(packageDirectory, "../../node_modules")],
    write: false,
    metafile: true,
    outfile: "widget.js",
    format: "iife",
    globalName: "__pythiaWidget",
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
    plugins: [runtimeImports()],
  });
  if (bundle.warnings.some((warning) => warning.id === "empty-import-meta"))
    throw new Error(
      "Widget artifacts cannot use import.meta. Import presentation from @pythia/widget-sdk; inline any required assets.",
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
  return { javascript, authoredCss, metafile: bundle.metafile };
}
