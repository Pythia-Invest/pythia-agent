import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { buildWidget } from "../../../packages/widget-sdk/build.mjs";
import { createQualificationProcesses } from "./processes.mjs";
import { createNativeDataFixture } from "./native-data.mjs";

const require = createRequire(import.meta.url);
const desk = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desk, "../..");
const scratch = join(root, ".local");
await mkdir(scratch, { recursive: true });
const temporary = await mkdtemp(join(scratch, "data-qualification-"));
const appDirectory = join(temporary, "apps/desk");
const abort = new AbortController();
const deadline = setTimeout(
  () => abort.abort(new Error("Data qualification exceeded three minutes")),
  180_000,
);
deadline.unref();
const stop = () => abort.abort(new Error("Data qualification interrupted"));
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
    "scripts",
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
  const route = join(appDirectory, "src/app/data-qualification");
  await mkdir(route);
  await cp(join(desk, "qualification/data-page.tsx"), join(route, "page.tsx"));
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
  await command(
    process.execPath,
    [join(appDirectory, "scripts/pdf-assets.mjs")],
    { cwd: appDirectory, env: environment, stdio: "inherit" },
  );
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

  // Both artifacts are compiled only after the actual production Desk build.
  const contents = {};
  for (const [id, entry] of [
    ["financial", join(desk, "qualification/financial-widget.tsx")],
    ["research", join(desk, "qualification/data-widget.tsx")],
  ]) {
    const artifact = join(temporary, `${id}.mjs`);
    await buildWidget(entry, artifact);
    contents[id] = await readFile(artifact, "utf8");
  }
  fixture = await createNativeDataFixture(
    contents,
    join(root, "packages/market-data/examples/valid.json"),
  );
  native = fixture.server;
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
        API_SERVER_KEY: "synthetic-data-qualification-key",
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const [{ port }] = await Promise.race([
    once(server, "message"),
    once(server, "exit").then(([code]) => {
      throw Error(`Server exited: ${code}`);
    }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${origin}/data-qualification`);
  const canonical = page.getByRole("region", {
    name: "Canonical",
    exact: true,
  });
  const duplicate = page.getByRole("region", {
    name: "Duplicate",
    exact: true,
  });
  const research = page.getByRole("region", { name: "Research", exact: true });
  await expect(canonical).toContainText("123.45");
  await expect(duplicate).toContainText("123.45");
  await expect(research).toContainText("Research revision 1");
  await expect.poll(() => fixture.streams.size).toBe(1);
  await expect(research).toContainText("Detail revision 1");
  assert.equal(fixture.counters.maxResources, 4);
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "true");
  assert.equal(fixture.counters.assetReads, 2);
  assert.equal(await page.locator("iframe").count(), 0);
  await research.getByRole("button", { name: "Notes 0" }).focus();
  await page.keyboard.press("Enter");
  fixture.update();
  await expect(canonical).toContainText("234.56");
  await expect(duplicate).toContainText("234.56");
  await expect(research).toContainText("Research revision 2");
  await expect(research).toContainText("Detail revision 2");
  await expect(research.getByRole("button", { name: "Notes 1" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(research.getByRole("button", { name: "Notes 1" })).toBeVisible();
  const connections = fixture.counters.connections;
  await page.getByRole("button", { name: "Toggle duplicate" }).click();
  await expect(duplicate).toHaveCount(0);
  assert.equal(fixture.counters.connections, connections);
  assert.equal(fixture.streams.size, 1);
  await page.getByRole("button", { name: "Toggle duplicate" }).click();
  await expect(duplicate).toContainText("234.56");
  assert.equal(fixture.counters.connections, connections);
  await page.getByRole("button", { name: "Read financial snapshot" }).click();
  await expect(
    page.getByText("Read 1; preference 7", { exact: true }),
  ).toBeVisible();
  assert.equal(fixture.counters.reads, 2);
  await page.getByRole("button", { name: "Toggle slow read" }).click();
  await expect.poll(() => fixture.counters.slowReads).toBe(1);
  await page.getByRole("button", { name: "Toggle slow read" }).click();
  await expect.poll(() => fixture.counters.cancelledReads).toBe(1);
  // Complete release ends the native channel. Dormant TanStack data cannot grant a remount.
  await page.getByRole("button", { name: "Toggle all" }).click();
  await expect.poll(() => fixture.streams.size).toBe(0);
  await expect(page.locator("style[data-pythia-widget-style]")).toHaveCount(0);
  fixture.hold(true);
  await page.getByRole("button", { name: "Toggle all" }).click();
  await expect.poll(() => fixture.streams.size).toBe(1);
  await expect(canonical).not.toContainText("234.56");
  await expect(research).toContainText("Research loading");
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "false");
  fixture.release();
  await expect(canonical).toContainText("234.56");
  await expect(research).toContainText("Research revision 2");
  assert.equal(fixture.counters.assetReads, 2);
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "true");
  fixture.setQuoteDenied(true);
  await expect(canonical).not.toContainText("234.56");
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "false");
  fixture.setQuoteDenied(false);
  await expect(canonical).toContainText("234.56");
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "true");
  // Status presentation must not hide the real request from a later reset.
  fixture.staleFinancial();
  fixture.holdQuoteReads();
  await canonical.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => fixture.pendingQuotes.size).toBe(1);
  fixture.staleFinancial();
  fixture.setQuoteDenied(true);
  await expect.poll(() => fixture.counters.cancelledQuoteReads).toBe(1);
  fixture.releaseQuoteReads();
  await expect(canonical).not.toContainText("234.56");
  await expect(canonical).not.toContainText("999");
  fixture.setQuoteDenied(false);
  await expect(canonical).toContainText("234.56");
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "true");
  fixture.staleFinancial();
  await expect(
    canonical.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await canonical.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(canonical).toContainText("345.67");
  await expect(duplicate).toContainText("345.67");
  await page.getByRole("button", { name: "Toggle duplicate" }).click();
  await page.getByRole("button", { name: "Toggle duplicate" }).click();
  await expect(duplicate).toContainText("345.67");
  // Hidden/resume reconnect replays the native owner's known older revision.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => fixture.streams.size).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect.poll(() => fixture.streams.size).toBe(1);
  await expect(canonical).toContainText("345.67");
  await expect(duplicate).toContainText("345.67");
  fixture.staleFinancial();
  fixture.denyReads();
  await expect(
    canonical.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await canonical.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(canonical).not.toContainText("234.56");
  await expect(canonical).not.toContainText("345.67");
  await expect(duplicate).not.toContainText("234.56");
  await expect(
    canonical.locator('[data-slot="canonical-binding-probe"]'),
  ).toHaveAttribute("data-has-history", "false");
  // Distinct feature query keys can still share one native resource. A denial
  // in one read must cancel the other in-flight read, not just clear its UI.
  await page.getByRole("button", { name: "Toggle peers" }).click();
  const peerA = page.getByRole("region", { name: "Peer A", exact: true });
  const peerB = page.getByRole("region", { name: "Peer B", exact: true });
  await expect(peerA).toContainText("Peer 321");
  await expect(peerB).toContainText("Peer 321");
  fixture.stalePeers();
  await peerA.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => fixture.peerReads.length).toBe(1);
  await peerB.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => fixture.pendingPeers.size).toBe(2);
  fixture.denyFirstPeer();
  await expect.poll(() => fixture.counters.cancelledPeerReads).toBe(1);
  fixture.releaseLatePeer();
  await expect(peerA).toContainText("Research unavailable");
  await expect(peerB).toContainText("Research unavailable");
  await expect(peerA).not.toContainText("Peer 999");
  await expect(peerB).not.toContainText("Peer 999");
  fixture.denyResearch();
  await expect(research).toContainText("Research unavailable");
  await expect(research).not.toContainText("Research revision 2");
  await expect(canonical).not.toContainText("234.56");
  fixture.disable();
  await page.getByRole("button", { name: "Refresh presentation" }).click();
  await expect(
    page.getByText("Presentation unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="widget-host"]')).toHaveCount(0);
  await expect(page.locator("style[data-pythia-widget-style]")).toHaveCount(0);
  await expect.poll(() => fixture.streams.size).toBe(0);
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(browserErrors, []);
  console.log(
    JSON.stringify(
      {
        next: require("next/package.json").version,
        react: require("react/package.json").version,
        build: "next build --webpack",
        artifactsBuiltAfterDesk: true,
        canonicalAndSpecialist: true,
        activeSharing: true,
        deferredBinding: true,
        canonicalHistoryWithheldUntilValidated: true,
        manualReadSharedWithoutReplayRegression: true,
        manualDenialClearsData: true,
        pendingReadCancelledAfterStatusAndReset: true,
        terminalReadDenialCancelsOtherQueryKey: true,
        dormantCacheRevalidated: true,
        nativeWithdrawal: true,
        counters: fixture.counters,
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
