#!/usr/bin/env node
/** Synthetic, offline preview of the actual compiled widget. No server or provider. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWidget } from "../../packages/widget-sdk/build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sdk = resolve(root, "packages/widget-sdk");
const requireSdk = createRequire(resolve(sdk, "package.json"));
const { build } = requireSdk("esbuild");
const { compile } = requireSdk("@tailwindcss/node");
const { Scanner } = requireSdk("@tailwindcss/oxide");
const feature = resolve(root, "runtime/managed/plugins/vega-lite");
const output = resolve(root, ".local/research-visuals-preview.html");
const artifact = resolve(feature, "dist/widgets/research-visual.mjs");
await buildWidget(resolve(feature, "widgets/research-visual.tsx"), artifact);
const compiler = await compile(
  '@import "tailwindcss";\n@import "@pythia/ui/styles.css";',
  { base: sdk, onDependency() {} },
);
// Offline preview uses system fallback fonts; product token values stay intact.

const bundle = await build({
  stdin: {
    contents: `
import React from "react";
import * as react from "react";
import * as reactDom from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import * as sdk from "./src/index.ts";
import { assertWidgetModule, WidgetStyleScope } from "./src/runtime.ts";
import * as widget from ${JSON.stringify(artifact)};
import { exampleVisual } from ${JSON.stringify(resolve(feature, "widgets/example.ts"))};
const host = {react, reactDom, jsxRuntime, sdk};
assertWidgetModule(widget, host);
const {Component} = widget.createWidget(host);
const styles = document.createElement("style"); styles.textContent = widget.css; document.head.append(styles);
const mode = new URLSearchParams(location.search).get("mode");
const input = structuredClone(exampleVisual);
if (mode === "blocked-url") input.data.spec.data = { url: "https://example.invalid/research.csv" };
if (mode === "blocked-binding") input.data.spec.params[0].bind = { input: "image", src: "https://example.invalid/binding.png", onerror: "window.bindingHandlerExecuted = true" };
if (mode === "blocked-handler") input.data.spec.params[0].bind = { input: "range", min: 0, max: 30, oninput: "window.bindingHandlerExecuted = true" };
if (mode === "external-paint") input.data.spec.mark = { type: "line", point: true, tooltip: true, color: { expr: "'url(https://example.invalid/paint.svg#x)'" } };
if (mode === "data-paint") {
  input.data.spec.data.values = input.data.spec.data.values.map(row => ({...row, paint: "url(https://example.invalid/paint.svg#x)"}));
  input.data.spec.encoding.color = {field: "paint", type: "nominal", scale: null};
}
if (mode === "annotated") {
  input.data.spec.layer = [{mark: input.data.spec.mark}, {transform: [{filter: "datum.year == 2030"}], mark: {type: "text", dy: -14, align: "right"}, encoding: {text: {value: "Synthetic forecast"}}}];
  delete input.data.spec.mark;
}
if (mode === "optional") {
  input.data.spec.params[0].name = "$growth"; delete input.data.spec.params[0].value;
  input.data.spec.transform[0].calculate = input.data.spec.transform[0].calculate.replace("growth", "$growth");
  input.data.parameters = { $growth: 11 };
}
if (mode === "calculation-error") input.data.spec.transform[0].calculate = "growth > 10 ? datum.missing.value : 1200 * pow(1 + growth / 100, datum.elapsed)";
if (mode === "filtered") {
  input.data.spec.transform.push({calculate: "'Selected year ' + datum.year", as: "selectionLabel"});
  input.data.spec.layer = [{mark: input.data.spec.mark, params: [{name: "chosen", select: {type: "point", on: "click", toggle: false}}]}, {transform: [{filter: {param: "chosen"}}], mark: {type: "text", dy: -14}, encoding: {text: {field: "selectionLabel", type: "nominal"}}}];
  delete input.data.spec.mark;
}

function App() {
  const [theme, setTheme] = React.useState("light");
  const changeTheme = () => { const next = theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = next; setTheme(next); };
  return <sdk.WidgetToolbarProvider><main><header className="preview-header"><div><p>PYTHIA · RESEARCH VISUALS</p><h1>Synthetic interactive preview</h1><p>Explore an invented business. This is the actual plugin renderer, using local sample data.</p></div><button onClick={changeTheme}>Use {theme === "light" ? "dark" : "light"} theme</button></header><sdk.WidgetToolbarOutlet/><div className="preview-card" data-pythia-widget={widget.metadata.scope}><WidgetStyleScope value={widget.metadata.scope}><Component data={input} options={{}} settings={{}} locale="en-US" timeZone="UTC" appearance={{theme,profile:"product"}} /></WidgetStyleScope></div></main></sdk.WidgetToolbarProvider>;
}
createRoot(document.getElementById("root")).render(<App/>);
`,
    loader: "tsx",
    resolveDir: sdk,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const candidates = new Scanner({}).scanFiles([
  { content: bundle.outputFiles[0].text, extension: "js" },
]);
const theme = compiler.build(candidates).replace(/@font-face\s*\{[^}]*\}/g, "");
const script = bundle.outputFiles[0].text.replaceAll("</script", "<\\/script");
const scriptHash = createHash("sha256").update(script).digest("base64");
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `<!doctype html><html lang="en" data-theme="light" data-profile="product"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pythia research visuals preview</title><style>${theme}\nbody{margin:0;background:var(--py-surface-canvas);color:var(--py-text-primary);font-family:Arial,sans-serif}main{max-width:960px;margin:32px auto;padding:0 16px}.preview-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.preview-header p{font-size:13px;color:var(--py-text-secondary);margin:8px 0}.preview-header h1{font-size:26px;font-weight:600}.preview-header button{border:1px solid var(--py-border-default);padding:8px 12px;border-radius:6px;white-space:nowrap}.preview-card{border:1px solid var(--py-border-default);border-radius:10px;overflow:hidden}@media(max-width:600px){main{margin:16px auto;padding:0 8px}.preview-header{align-items:flex-start;flex-direction:column;gap:8px}.preview-header h1{font-size:22px}}</style></head><body><div id="root"></div><script type="module">${script}</script></body></html>`,
);
// Read the same fixture through a temporary in-memory Node bundle.
const fixture = await build({
  entryPoints: [resolve(feature, "widgets/example.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { exampleVisual } = await import(
  `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString("base64")}`
);
await writeFile(
  resolve(root, ".local/example.vega-lite.json"),
  `${JSON.stringify(exampleVisual, null, 2)}\n`,
);
console.log(`Preview: ${output}`);
if (process.argv.includes("--verify")) {
  const requireDesk = createRequire(resolve(root, "apps/desk/package.json"));
  const { chromium } = requireDesk("@playwright/test");
  const browser = await chromium.launch({
    ...(process.env.PYTHIA_PREVIEW_BROWSER_CHANNEL
      ? { channel: process.env.PYTHIA_PREVIEW_BROWSER_CHANNEL }
      : {}),
    ...(process.env.PYTHIA_PREVIEW_BROWSER_EXECUTABLE
      ? { executablePath: process.env.PYTHIA_PREVIEW_BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 1050 },
    });
    const errors = [];
    const requests = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/^https?:/, (route) => route.abort());
    await page.goto(pathToFileURL(output).href);
    const marks = page.locator("canvas");
    await marks.first().waitFor();
    const hoverFirstPoint = async () => {
      const point = await marks.first().evaluate((canvas) => {
        const { width, height } = canvas;
        const pixels = canvas
          .getContext("2d")
          .getImageData(0, 0, width, height).data;
        for (let x = 8; x < width; x++)
          for (let y = 8; y < height - 8; y++) {
            const i = (y * width + x) * 4;
            const colors = [pixels[i], pixels[i + 1], pixels[i + 2]];
            if (
              pixels[i + 3] > 150 &&
              Math.max(...colors) - Math.min(...colors) > 35
            )
              return { x: (x + 2) / width, y: y / height };
          }
        return null;
      });
      assert.ok(point, "Chart contains a visible series");
      const box = await marks.first().boundingBox();
      assert.ok(box);
      await page.mouse.move(
        box.x + point.x * box.width,
        box.y + point.y * box.height,
      );
      await page
        .getByRole("status")
        .filter({ hasText: "Revenue (USD m)" })
        .waitFor();
    };
    const action = async (name) => {
      await page.getByRole("button", { name: "Actions", exact: true }).click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    };
    await hoverFirstPoint();
    await page
      .getByRole("status")
      .filter({ hasText: "Revenue (USD m)" })
      .waitFor();
    const growth = page.locator('input[type="range"]').first();
    await growth.fill("12");
    await hoverFirstPoint();
    await page.getByRole("status").filter({ hasText: "1,344" }).waitFor();
    const inspectPng = async (bytes) => {
      const pixel = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data];
      }, bytes.toString("base64"));
      assert.equal(
        pixel[3],
        255,
        "Downloaded PNG has an opaque captured-theme background",
      );
      return pixel;
    };
    for (const format of ["SVG", "PNG"]) {
      const pending = page.waitForEvent("download");
      await action(`Export ${format}`);
      const exported = await pending;
      const bytes = await readFile(await exported.path());
      if (format === "SVG") assert.match(bytes.toString(), /<svg/);
      else {
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.ok(
          bytes.readUInt32BE(16) >= 2000,
          "PNG uses an independent high-resolution export view",
        );
        const pixel = await inspectPng(bytes);
        assert.ok(pixel[0] > 200, "Light export background is light");
        await writeFile(
          resolve(root, ".local/research-visual-export.png"),
          bytes,
        );
      }
    }
    const pending = page.waitForEvent("download");
    await action("Download scenario");
    const downloaded = await pending;
    const saved = JSON.parse(await readFile(await downloaded.path(), "utf8"));
    assert.equal(saved.data.parameters.growth, 12);
    await page.getByRole("button", { name: "Use dark theme" }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.setViewportSize({ width: 360, height: 1100 });
    await marks.first().waitFor();
    assert.equal(await growth.inputValue(), "12");
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[data-slot="button"]'))
          .color === getComputedStyle(document.body).color,
    );
    const darkDownload = page.waitForEvent("download");
    await action("Export PNG");
    const darkBytes = await readFile(await (await darkDownload).path());
    assert.ok(
      (await inspectPng(darkBytes))[0] < 80,
      "Dark export background is dark",
    );
    await writeFile(
      resolve(root, ".local/research-visual-export-dark.png"),
      darkBytes,
    );
    await page.waitForFunction(() => {
      const svg = document.querySelector("canvas");
      return svg && svg.getBoundingClientRect().width < 340;
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(root, ".local/research-visuals-preview-narrow.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1100, height: 1050 });
    await page.getByRole("button", { name: "Use light theme" }).click();
    await page.waitForFunction(() => {
      const svg = document.querySelector("canvas");
      return svg && svg.getBoundingClientRect().width > 800;
    });
    await page.screenshot({
      path: resolve(root, ".local/research-visuals-preview.png"),
      fullPage: true,
    });
    for (const mode of ["blocked-url", "blocked-binding", "blocked-handler"]) {
      await page.goto(`${pathToFileURL(output).href}?mode=${mode}`);
      await page.getByRole("alert").waitFor();
      assert.equal(await page.locator("canvas").count(), 0);
      assert.equal(await page.locator('input[type="image"]').count(), 0);
      assert.equal(
        await page.evaluate(() =>
          Reflect.get(window, "bindingHandlerExecuted"),
        ),
        undefined,
      );
    }
    for (const mode of ["external-paint", "data-paint"]) {
      await page.goto(`${pathToFileURL(output).href}?mode=${mode}`);
      await marks.first().waitFor();
      await action("Export SVG");
      await page
        .getByRole("status")
        .filter({ hasText: "SVG export blocked" })
        .waitFor();
    }
    await page.goto(`${pathToFileURL(output).href}?mode=filtered`);
    await marks.first().waitFor();
    await hoverFirstPoint();
    await page.mouse.down();
    await page.mouse.up();
    const filteredDownload = page.waitForEvent("download");
    await action("Export SVG");
    const filteredSvg = await readFile(
      await (await filteredDownload).path(),
      "utf8",
    );
    assert.match(filteredSvg, /Selected year 2026/);
    assert.doesNotMatch(
      filteredSvg,
      /Selected year 202[789]|Selected year 2030/,
      "Export preserves native selected filter",
    );
    await writeFile(
      resolve(root, ".local/research-visual-export-filtered.svg"),
      filteredSvg,
    );
    await page.goto(`${pathToFileURL(output).href}?mode=optional`);
    await marks.first().waitFor();
    assert.equal(await growth.inputValue(), "11");
    await growth.fill("13");
    const optionalDownload = page.waitForEvent("download");
    await action("Download scenario");
    assert.equal(
      JSON.parse(await readFile(await (await optionalDownload).path(), "utf8"))
        .data.parameters.$growth,
      13,
    );
    await action("Reset visual");
    assert.equal(await growth.inputValue(), "11");
    await page.goto(`${pathToFileURL(output).href}?mode=calculation-error`);
    await marks.first().waitFor();
    await growth.fill("12");
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    assert.equal(
      await page
        .getByRole("menuitem", { name: "Export PNG", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await page.keyboard.press("Escape");
    await action("Reset visual");
    await marks.first().waitFor();
    assert.equal(await growth.inputValue(), "8");
    await page.goto(`${pathToFileURL(output).href}?mode=annotated`);
    await page.setViewportSize({ width: 360, height: 1100 });
    await marks.first().waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(root, ".local/research-visuals-preview-annotated.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
    console.log(
      "Verified Vega-Lite hover, bound calculation, opaque light/dark SVG/PNG export, native selection-filter export, parameter download, optional/$ parameters, reset and error-disabled export, blocked URL and executable binding rejection, strict CSP, dark theme and 360px layout.",
    );
  } finally {
    await browser.close();
  }
}
