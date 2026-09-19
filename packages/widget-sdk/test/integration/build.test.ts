import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as react from "react";
import * as reactDom from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import * as sdk from "../../src/index";
import { assertWidgetModule, type WidgetHost } from "../../src/runtime";
import { afterEach, expect, test } from "vitest";
import { buildWidget } from "../../build.mjs";
import {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_MODULE_MARKER,
} from "../../src/artifact.mjs";

const host: WidgetHost = { react, reactDom, jsxRuntime, sdk };
const directories: string[] = [];
async function project() {
  const directory = await mkdtemp(join(tmpdir(), "pythia-widget-build-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("builds an inert module that receives the actual host React, context, and UI", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widgets", "research.mjs");
  await mkdir(join(directory, "node_modules", "local-caption"), {
    recursive: true,
  });
  await writeFile(
    join(directory, "node_modules", "local-caption", "package.json"),
    JSON.stringify({ name: "local-caption", main: "index.js" }),
  );
  await writeFile(
    join(directory, "node_modules", "local-caption", "index.js"),
    'export default "Local dependency";',
  );
  await writeFile(join(directory, "detail.css"), ".detail { padding: 3px }");
  await writeFile(
    entry,
    `
    import { useState, useContext } from "react";
    import { InstrumentTile, cn } from "@pythia/widget-sdk";
    import caption from "local-caption";
    import "./detail.css";
    globalThis.widgetFactoryRuns = (globalThis.widgetFactoryRuns ?? 0) + 1;
    export default function Widget({ data }) {
      const [expanded, setExpanded] = useState(false);
      const context = useContext(data.context);
      return <section className={cn("p-3 text-foreground bg-raised", expanded && "grid gap-2")}>
        <button className="detail" onClick={() => setExpanded(!expanded)}>{caption}: {context}</button>
        {data.rows.map(item => <InstrumentTile key={item.symbol} item={item} />)}
      </section>;
    }
    Widget.identity = { useState, InstrumentTile };
    export const binding = {
      queries() { return []; },
      render(input) { return { data: input, state: "ready" }; },
    };
  `,
  );
  const result = await buildWidget(entry, output);
  const contents = await readFile(output, "utf8");
  expect(contents.startsWith(WIDGET_MODULE_MARKER)).toBe(true);
  expect(result.bytes).toBe(Buffer.byteLength(contents));
  // A small composition carries neither React nor the shared UI implementation.
  expect(result.bytes).toBeLessThan(15_000);
  const globals = globalThis as typeof globalThis & {
    widgetFactoryRuns?: number;
  };
  delete globals.widgetFactoryRuns;
  const artifact: unknown = await import(pathToFileURL(output).href);
  expect(globals.widgetFactoryRuns).toBeUndefined();
  assertWidgetModule(artifact, host);
  const { Component: Widget, binding } = artifact.createWidget(host);
  expect(globals.widgetFactoryRuns).toBe(1);
  expect((Widget as typeof Widget & { identity: unknown }).identity).toEqual({
    useState: react.useState,
    InstrumentTile: sdk.InstrumentTile,
  });
  expect(binding?.queries({})).toEqual([]);
  expect(
    binding?.render("Qualified display", [], [], { formatTimestamp: String }),
  ).toEqual({
    data: "Qualified display",
    state: "ready",
  });
  const context = react.createContext("Missing provider");
  const markup = renderToStaticMarkup(
    react.createElement(
      context.Provider,
      { value: "Shared Desk context" },
      react.createElement(Widget, {
        data: { rows: [], context },
        options: {},
        settings: {},
        locale: "en-US",
        timeZone: "UTC",
      }),
    ),
  );
  expect(markup).toContain("Shared Desk context");
  expect(artifact.metadata.imports.react).toEqual(["useContext", "useState"]);
  expect(artifact.metadata.imports.sdk).toEqual(["InstrumentTile", "cn"]);
  expect(artifact.css).toContain(artifact.metadata.scope);
  expect(await readdir(join(directory, "widgets"))).toEqual(["research.mjs"]);
  delete globals.widgetFactoryRuns;
  console.info(
    `Representative widget: ${result.bytes} bytes, ${result.durationMs} ms`,
  );
}, 20_000);

test("a failed build leaves an existing artifact and source intact", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  const source =
    'import Missing from "missing-component"; export default Missing;';
  await writeFile(entry, source);
  await writeFile(output, "Previously reviewed artifact");
  await expect(buildWidget(entry, output)).rejects.toThrow(/missing-component/);
  expect(await readFile(output, "utf8")).toBe("Previously reviewed artifact");
  expect(await readFile(entry, "utf8")).toBe(source);
  expect((await readdir(directory)).sort()).toEqual([
    "widget.mjs",
    "widget.tsx",
  ]);
});

test("rejects oversized output before replacing an existing artifact", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  await writeFile(
    entry,
    `export default function Widget() { return <pre>${"x".repeat(MAX_WIDGET_ARTIFACT_BYTES)}</pre>; }`,
  );
  await writeFile(output, "Previously reviewed artifact");
  await expect(buildWidget(entry, output)).rejects.toThrow(/maximum is/);
  expect(await readFile(output, "utf8")).toBe("Previously reviewed artifact");
}, 20_000);

test("rejects import.meta rather than publishing an artifact that fails at startup", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  await writeFile(
    entry,
    'const asset = new URL("./image.svg", import.meta.url); export default function Widget() { return <img src={asset.href} />; }',
  );
  await writeFile(output, "Previously reviewed artifact");
  await expect(buildWidget(entry, output)).rejects.toThrow(
    /cannot use import.meta.*@pythia\/widget-sdk/,
  );
  expect(await readFile(output, "utf8")).toBe("Previously reviewed artifact");
});

test("refuses an output alias pointing to the component source", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  const source = "export default function Widget() { return null; }";
  await writeFile(entry, source);
  await symlink(entry, output);
  await expect(buildWidget(entry, output)).rejects.toThrow(/cannot replace/);
  expect(await readFile(entry, "utf8")).toBe(source);
});

test("CSS contributes to artifact identity, and unsupported global CSS preserves prior output", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  const css = join(directory, "widget.css");
  await writeFile(
    entry,
    'import "./widget.css"; export default function Widget() { return <div className="detail animate-spin hover:scale-105" />; }',
  );
  await writeFile(css, ".detail { padding: 3px }");
  await buildWidget(entry, output);
  const first: unknown = await import(`${pathToFileURL(output).href}?first`);
  assertWidgetModule(first, host);
  await writeFile(css, ".detail { padding: 5px }");
  await buildWidget(entry, output);
  const second: unknown = await import(`${pathToFileURL(output).href}?second`);
  assertWidgetModule(second, host);
  expect(second.metadata.scope).not.toBe(first.metadata.scope);
  const previous = await readFile(output, "utf8");
  await writeFile(
    css,
    '@font-face { font-family: "Widget Font"; src: url(data:font/woff2;base64,AA==) }',
  );
  await expect(buildWidget(entry, output)).rejects.toThrow(/global @font-face/);
  expect(await readFile(output, "utf8")).toBe(previous);
});

test("unsupported host imports and missing SDK exports fail before replacing a module", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.mjs");
  await writeFile(output, "Prior widget");
  for (const source of [
    'import { createRoot } from "react-dom/client"; export default createRoot;',
    'import { FutureComponent } from "@pythia/widget-sdk"; export default FutureComponent;',
  ]) {
    await writeFile(entry, source);
    await expect(buildWidget(entry, output)).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("Prior widget");
  }
});
