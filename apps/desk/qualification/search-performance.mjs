import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { expect } from "@playwright/test";
import { search } from "./search-fixture.mjs";

const modulePath = "/api/plugins/pythia-market-data/widgets/top-bar";
const round = (value) => Math.round(value * 10) / 10;
const counts = (rows) =>
  Object.fromEntries(
    [...new Set(rows)]
      .sort()
      .map((path) => [path, rows.filter((value) => value === path).length]),
  );

/** Browser and native counts are separate: a cached browser module must not
 * conceal repeated native asset reads during periodic descriptor checks. */
export function createSearchPerformanceProbe() {
  const native = [],
    browser = [],
    fixtures = [];
  return {
    attach(page) {
      page.on("request", (request) =>
        browser.push({
          path: new URL(request.url()).pathname,
          method: request.method(),
          time: performance.now(),
        }),
      );
    },
    native(path, body) {
      native.push({ path, body, time: performance.now() });
    },
    search(query) {
      const start = performance.now();
      const result = search(query);
      fixtures.push({ query, start, ready: performance.now() });
      return result;
    },
    mark() {
      return {
        native: native.length,
        browser: browser.length,
        time: performance.now(),
      };
    },
    since(mark) {
      const nativeRows = native.slice(mark.native);
      const browserRows = browser.slice(mark.browser);
      return {
        elapsedMs: round(performance.now() - mark.time),
        moduleDownloads: browserRows.filter((row) => row.path === modulePath)
          .length,
        nativeModuleReads: nativeRows.filter(
          (row) =>
            row.path.endsWith("/plugins/pythia-market-data/widgets") &&
            row.body.arguments?.asset,
        ).length,
        nativeSearchCalls: nativeRows.filter(
          (row) =>
            row.body.arguments?.action === "search_catalogue" ||
            row.body.resources?.some(
              (resource) => resource.arguments?.action === "search_catalogue",
            ),
        ).length,
        browserRequests: counts(
          browserRows.map((row) => `${row.method} ${row.path}`),
        ),
        nativeRequests: counts(nativeRows.map((row) => row.path)),
      };
    },
    coldSearch(query, inputStarted, visible) {
      const fixture = fixtures.find((item) => item.query === query);
      assert(
        fixture,
        "The cold search must reach the synthetic native fixture.",
      );
      const request = native.find((row) =>
        row.body.resources?.some(
          (resource) => resource.arguments?.query === query,
        ),
      );
      assert(request, "The cold search must use protected native updates.");
      return {
        inputToResultsMs: round(visible - inputStarted),
        inputToNativeRequestMs: round(request.time - inputStarted),
        syntheticFixtureBuildMs: round(fixture.ready - fixture.start),
        fixtureReadyToVisibleMs: round(visible - fixture.ready),
      };
    },
  };
}

/** Report elapsed times, never gate on a machine-specific latency threshold. */
export async function qualifySearchPerformance(page, origin, probe) {
  probe.attach(page);
  const initial = probe.mark();
  const coldStarted = performance.now();
  await page.goto(origin);
  const input = page.getByRole("combobox", {
    name: "Search investments and chats",
  });
  await expect(input).toBeVisible();
  const moduleReadyMs = round(performance.now() - coldStarted);
  await input.click();
  const searchStarted = performance.now();
  await input.fill("performance");
  const result = page.getByRole("button", { name: /Apple ordinary share/ });
  await expect(result).toBeVisible();
  const cold = {
    moduleReadyMs,
    ...probe.coldSearch("performance", searchStarted, performance.now()),
    ...probe.since(initial),
  };
  assert.equal(cold.moduleDownloads, 1);
  assert.equal(cold.nativeSearchCalls, 1);
  await input.press("Escape");

  const documentStart = await page.evaluate(() => performance.timeOrigin);
  const warmStart = probe.mark();
  await page.getByRole("link", { name: "Watchlist", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/watchlist`);
  await expect(input).toBeVisible();
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(input).toBeVisible();
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    documentStart,
  );
  const warmNavigation = probe.since(warmStart);
  assert.equal(warmNavigation.moduleDownloads, 0);
  assert.equal(warmNavigation.nativeModuleReads, 0);

  const reopenStart = probe.mark();
  await input.click();
  await input.fill("performance");
  await expect(result).toBeVisible();
  const warmReopen = probe.since(reopenStart);
  assert.equal(warmReopen.moduleDownloads, 0);
  assert.equal(warmReopen.nativeSearchCalls, 0);
  await input.press("Escape");

  const idleStart = probe.mark();
  // Deliberate observation window spans the host's 15-second authority check.
  // This is measurement duration, not an assertion on response latency.
  await page.waitForTimeout(16_000);
  const idle = probe.since(idleStart);
  assert.equal(idle.moduleDownloads, 0);
  assert.equal(idle.nativeModuleReads, 0);
  assert.equal(idle.nativeSearchCalls, 0);
  const measurements = { cold, warmNavigation, warmReopen, idle };
  console.log(JSON.stringify({ searchPerformance: measurements }, null, 2));
  return measurements;
}
