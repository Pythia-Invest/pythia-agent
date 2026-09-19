import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";
import { buildWidget } from "../../../packages/widget-sdk/build.mjs";
import { createQualificationProcesses } from "./processes.mjs";
import { createNativeWidgetFixture } from "./native-widgets.mjs";

const require = createRequire(import.meta.url);
const desk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desk, "../..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const temporary = await mkdtemp(join(scratch, "widget-qualification-"));
const appDirectory = join(temporary, "apps/desk");
const abort = new AbortController();
const deadline = setTimeout(
  () => abort.abort(new Error("Widget qualification exceeded three minutes")),
  180_000,
);
deadline.unref();
const stop = () => abort.abort(new Error("Widget qualification interrupted"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const processes = createQualificationProcesses(abort.signal);
const { child, command } = processes;
let browser;
let native;
let fixture;

try {
  // Copy the actual Desk app, not a substitute bundler/harness application.
  // The copy keeps ordinary source, node_modules and .next untouched.
  await mkdir(appDirectory, { recursive: true });
  for (const name of [
    "src",
    "public",
    "package.json",
    "next.config.mjs",
    "tailscale.mjs",
    "tailscale.d.mts",
    "postcss.config.mjs",
    "tsconfig.json",
  ]) {
    await cp(join(desk, name), join(appDirectory, name), { recursive: true });
  }
  for (const name of [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
  ]) {
    await cp(join(root, name), join(temporary, name));
  }
  await symlink(join(root, "packages"), join(temporary, "packages"), "dir");
  await symlink(
    join(root, "node_modules"),
    join(temporary, "node_modules"),
    "dir",
  );
  await symlink(
    join(desk, "node_modules"),
    join(appDirectory, "node_modules"),
    "dir",
  );
  const route = join(appDirectory, "src/app/widget-qualification");
  await mkdir(route);
  await cp(
    join(desk, "qualification/widget-page.tsx"),
    join(route, "page.tsx"),
  );
  // A minimal environment excludes all ambient profile/provider credentials.
  const environment = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG"].flatMap((key) =>
      process.env[key] ? [[key, process.env[key]]] : [],
    ),
  );
  Object.assign(environment, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  console.log(
    "Building the copied Desk with its pinned production webpack toolchain.",
  );
  await command(
    process.execPath,
    [require.resolve("next/dist/bin/next"), "build", "--webpack"],
    {
      cwd: appDirectory,
      env: environment,
      stdio: "inherit",
    },
  );
  abort.signal.throwIfAborted();

  // Artifact creation happens strictly after next build has completed.
  const artifact = join(temporary, "probe.mjs");
  const measurement = await buildWidget(
    join(desk, "qualification/author-widget.tsx"),
    artifact,
  );
  const content = await readFile(artifact, "utf8");
  const module = await import(pathToFileURL(artifact).href);
  fixture = createNativeWidgetFixture(content, module);
  native = fixture.server;
  const { assets, assetReads } = fixture;
  await new Promise((resolve, reject) => {
    native.once("error", reject);
    native.listen(0, "127.0.0.1", resolve);
  });
  const server = child(
    process.execPath,
    [join(desk, "qualification/server.mjs"), appDirectory],
    {
      cwd: appDirectory,
      env: {
        ...environment,
        PYTHIA_HERMES_PROFILE: "synthetic",
        PYTHIA_HERMES_API_URL: `http://127.0.0.1:${native.address().port}`,
        API_SERVER_KEY: "synthetic-widget-qualification-key",
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const [{ port }] = await Promise.race([
    once(server, "message"),
    once(server, "exit").then(([code]) => {
      throw new Error(`Qualification server exited: ${code}`);
    }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  const results = [];
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    fixture.setEnabled(true);
    assetReads.clear();
    const context = await browser.newContext({
      viewport,
      colorScheme: "light",
    });
    const page = await context.newPage();
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/widget-qualification`);
    const first = page.getByRole("region", { name: "Instance 1" });
    const second = page.getByRole("region", { name: "Instance 2" });
    await expect(first.getByText("React identity: true")).toBeVisible();
    await expect(second.getByText("UI identity: true")).toBeVisible();
    await expect(first.getByText("host-context-0")).toBeVisible();
    assert.equal(await page.locator("iframe").count(), 0);
    assert.equal(assetReads.get("probe"), 1);
    assert.equal(await page.evaluate(() => globalThis.widgetFactories), 1);
    assert.equal(
      await page.locator("style[data-pythia-widget-style]").count(),
      1,
    );
    await expect(first.locator('[data-slot="qualification-widget"]')).toHaveCSS(
      "padding-top",
      "17px",
    );
    // Add the same author-only class outside @scope after Desk's CSS is built.
    const outsidePadding = await page.evaluate(() => {
      const outside = document.createElement("div");
      outside.className = "p-[17px]";
      document.body.append(outside);
      const padding = getComputedStyle(outside).paddingTop;
      outside.remove();
      return padding;
    });
    assert.equal(outsidePadding, "0px");
    const animation = await first
      .getByLabel("Animated marker")
      .evaluate((element) => getComputedStyle(element).animationName);
    assert.notEqual(animation, "none");
    assert.notEqual(animation, "spin");
    await first.getByRole("button", { name: "Count 0" }).hover();
    await expect(first.getByRole("button", { name: "Count 0" })).toHaveCSS(
      "scale",
      "1.05",
    );
    const priceStyle = async (locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          weight: style.fontWeight,
          color: style.color,
          numbers: style.fontVariantNumeric,
        };
      });
    const sharedPrice = page
      .getByTestId("shared-price")
      .locator('[data-slot="instrument-price"]');
    const widgetPrice = first.locator('[data-slot="instrument-price"]');
    assert.deepEqual(
      await priceStyle(widgetPrice),
      await priceStyle(sharedPrice),
    );
    const light = await priceStyle(widgetPrice);
    await first.getByRole("button", { name: "Count 0" }).click();
    await page.getByRole("button", { name: "Update props" }).click();
    await expect(first.getByText("host-context-1")).toBeVisible();
    await expect(
      first.getByText("updated / true / fr-BE / Europe/Brussels / light"),
    ).toBeVisible();
    await expect(first.getByRole("button", { name: "Count 1" })).toBeVisible();
    await expect(second.getByRole("button", { name: "Count 0" })).toBeVisible();
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(
      first.getByText("updated / true / fr-BE / Europe/Brussels / dark"),
    ).toBeVisible();
    assert.notEqual((await priceStyle(widgetPrice)).color, light.color);
    assert.deepEqual(
      await priceStyle(widgetPrice),
      await priceStyle(sharedPrice),
    );
    await expect(first.getByRole("button", { name: "Count 1" })).toBeVisible();
    await page.getByRole("button", { name: "Toggle instances" }).click();
    await expect(first).toHaveCount(0);
    await expect(page.locator("style[data-pythia-widget-style]")).toHaveCount(
      0,
    );
    assert.equal(await page.evaluate(() => globalThis.widgetUnmounts), 2);
    await page.evaluate(() =>
      window.dispatchEvent(new Event("widget-qualification")),
    );
    assert.equal(await page.evaluate(() => globalThis.widgetEvents ?? 0), 0);
    await page.getByRole("button", { name: "Toggle instances" }).click();
    await expect(first.getByRole("button", { name: "Count 0" })).toBeVisible();
    assert.equal(assetReads.get("probe"), 1);
    assert.equal(await page.evaluate(() => globalThis.widgetFactories), 1);
    await page.getByRole("button", { name: "Fail one renderer" }).click();
    await expect(first.getByRole("status")).toContainText(
      "could not be displayed",
    );
    await second.getByRole("button", { name: "Count 0" }).click();
    await expect(second.getByRole("button", { name: "Count 1" })).toBeVisible();
    await page.getByRole("button", { name: "Update props" }).click();
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(first.getByRole("status")).toContainText(
      "could not be displayed",
    );
    await expect(second.getByRole("button", { name: "Count 1" })).toBeVisible();
    await page.getByRole("button", { name: "Change presentation" }).click();
    await expect(first.getByRole("button", { name: "Count 0" })).toBeVisible();
    assert.equal(assetReads.get("probe"), 1);
    assert.equal(await page.evaluate(() => globalThis.widgetFactories), 1);
    await page.getByRole("button", { name: "Load incompatible" }).click();
    const failure = page.getByRole("region", { name: "Failure case" });
    await expect(failure.getByRole("status")).toContainText("incompatible");
    assert.equal(
      await page.evaluate(() => globalThis.incompatibleWidgetRan ?? false),
      false,
    );
    await page.getByRole("button", { name: "Load missing" }).click();
    await expect(failure.getByRole("status")).not.toHaveText("Loading widget…");
    assert.equal(assetReads.get("missing"), 1);
    await failure.getByRole("button", { name: "Retry widget" }).click();
    await expect(failure.getByText("Recovered widget")).toBeVisible();
    assert.equal(assetReads.get("missing"), 2);
    assert.equal(
      await page.evaluate(() => globalThis.widgetRecoveryFactories),
      1,
    );
    await page.getByRole("button", { name: "Load incompatible" }).click();
    await expect(failure.getByRole("status")).toContainText("incompatible");
    await page.getByRole("button", { name: "Load missing" }).click();
    await expect(failure.getByText("Recovered widget")).toBeVisible();
    assert.equal(assetReads.get("missing"), 2);
    assert.equal(
      await page.evaluate(() => globalThis.widgetRecoveryFactories),
      1,
    );
    fixture.setEnabled(false);
    const assetUrl = `/api/plugins/synthetic/widgets/probe?revision=${assets.get("probe").sha256}`;
    const denied = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        headers: { "If-None-Match": '"cached"' },
      });
      return {
        status: response.status,
        type: response.headers.get("content-type"),
      };
    }, assetUrl);
    assert.equal(denied.status, 403);
    assert.match(denied.type, /application\/json/);
    await page.getByRole("button", { name: "Refresh presentation" }).click();
    await expect(second).toHaveCount(0);
    await expect(
      page.getByText("Presentation unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="widget-host"]')).toHaveCount(0);
    await expect(page.locator("style[data-pythia-widget-style]")).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Recovered widget", { exact: true }),
    ).toHaveCount(0);
    results.push({
      viewport,
      passed: true,
      sharedFactoryExecutions: 1,
      sharedModuleRequests: 1,
      recoveryRequests: 2,
      recoveredFactoryExecutions: 1,
    });
    await context.close();
  }
  console.log(
    JSON.stringify(
      {
        next: require("next/package.json").version,
        react: require("react/package.json").version,
        build: "next build --webpack",
        artifactBuiltAfterDesk: true,
        artifactBytes: measurement.bytes,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await processes.close();
  if (native) {
    native.closeAllConnections();
    await new Promise((resolve) => native.close(resolve));
  }
  await rm(temporary, { recursive: true, force: true });
  clearTimeout(deadline);
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
