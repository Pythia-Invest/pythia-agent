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
import { afterEach, expect, test } from "vitest";
import { buildWidget } from "../../build.mjs";
import {
  MAX_WIDGET_ARTIFACT_BYTES,
  WIDGET_ARTIFACT_MARKER,
} from "../../src/artifact.mjs";

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

test("bundles an external React component with managed presentation and native Tailwind", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widgets", "research.html");
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
  await writeFile(
    join(directory, "detail.css"),
    '.detail::after{content:"</style>"}',
  );
  await writeFile(
    entry,
    `
    import { useState } from "react";
    import { InstrumentTile, cn } from "@pythia/widget-sdk";
    import caption from "local-caption";
    import "./detail.css";
    export default function Widget({ data }) {
      const [expanded, setExpanded] = useState(false);
      return <section className={cn("p-3 text-foreground bg-raised", expanded && "grid gap-2")}>
        <button className="detail" onClick={() => setExpanded(!expanded)}>{caption}</button>
        {data.rows.map(item => <InstrumentTile key={item.symbol} item={item} />)}
        <span>{"</script><script>not executable markup</script>"}</span>
      </section>;
    }
  `,
  );
  const result = await buildWidget(entry, output);
  const html = await readFile(output, "utf8");
  expect(html.startsWith(WIDGET_ARTIFACT_MARKER)).toBe(true);
  expect(result.bytes).toBe(Buffer.byteLength(html));
  expect(result.bytes).toBeLessThanOrEqual(MAX_WIDGET_ARTIFACT_BYTES);
  expect(html).toMatch(/\.p-3[,{]/);
  expect(html).toContain("--py-surface-raised");
  expect(html).toContain("Local dependency");
  expect(html.match(/<\/script>/gi)).toHaveLength(1);
  expect(html.match(/<\/style>/gi)).toHaveLength(1);
  expect(html).not.toContain("@font-face");
  expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/i);
  expect(await readdir(join(directory, "widgets"))).toEqual(["research.html"]);
  console.info(
    `Representative widget: ${result.bytes} bytes, ${result.durationMs} ms`,
  );
}, 20_000);

test("a failed build leaves an existing artifact and source intact", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.html");
  const source =
    'import Missing from "missing-component"; export default Missing;';
  await writeFile(entry, source);
  await writeFile(output, "Previously reviewed artifact");
  await expect(buildWidget(entry, output)).rejects.toThrow(/missing-component/);
  expect(await readFile(output, "utf8")).toBe("Previously reviewed artifact");
  expect(await readFile(entry, "utf8")).toBe(source);
  expect((await readdir(directory)).sort()).toEqual([
    "widget.html",
    "widget.tsx",
  ]);
});

test("rejects oversized output before replacing an existing artifact", async () => {
  const directory = await project();
  const entry = join(directory, "widget.tsx");
  const output = join(directory, "widget.html");
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
  const output = join(directory, "widget.html");
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
  const output = join(directory, "widget.html");
  const source = "export default function Widget() { return null; }";
  await writeFile(entry, source);
  await symlink(entry, output);
  await expect(buildWidget(entry, output)).rejects.toThrow(/cannot replace/);
  expect(await readFile(entry, "utf8")).toBe(source);
});
