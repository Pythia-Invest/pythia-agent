import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

const path = "research/synthetic-growth.pythia-visual.json";
const artifact = {
  format: "pythia-visual",
  version: 1,
  title: "Synthetic growth scenario",
  summary: "Invented revenue sensitivity for browser qualification.",
  presentation: {
    plugin: "pythia-research-visuals",
    widget: "research-visual",
    input_contract: "pythia.research-visual.v1",
  },
  data: {
    kind: "vega-lite",
    asOf: "2026-09-22",
    sources: [{ label: "Invented revenue", date: "2026-09-22" }],
    assumptions: ["Revenue starts at 100; growth is illustrative."],
    parameters: { growth: 10 },
    spec: {
      width: "container",
      height: 180,
      params: [
        {
          name: "growth",
          value: 8,
          bind: {
            input: "range",
            name: "Revenue growth (%) ",
            min: 0,
            max: 30,
            step: 1,
          },
        },
      ],
      data: { values: [{ period: "Next year", revenue: 100 }] },
      transform: [
        { calculate: "datum.revenue * (1 + growth / 100)", as: "projected" },
      ],
      mark: "bar",
      encoding: {
        x: { field: "period", type: "nominal" },
        y: {
          field: "projected",
          type: "quantitative",
          scale: { domain: [0, 150] },
          title: "Synthetic revenue",
        },
      },
    },
  },
};

// Requires the built, enabled research-visuals plugin on PYTHIA_DESK_URL.
// Only its read-only presentation/module routes reach the running stack;
// history and artifact bytes are synthetic, and all other APIs stay intercepted.
test("chat visual opens the native renderer and keeps scenario changes local", async ({
  page,
}) => {
  const chat = await fixture(page);
  const body = JSON.stringify(artifact);
  let descriptorReads = 0;
  let busyResponseCompleted = false;
  let denyRenderer = false;
  await page.route("**/api/workspace/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("path") !== path) return route.fallback();
    if (url.pathname.endsWith("/entry"))
      return route.fulfill({
        json: {
          path,
          name: "synthetic-growth.pythia-visual.json",
          kind: "text",
          size: Buffer.byteLength(body),
          modified: "2026-09-22T00:00:00.000Z",
          revision: "synthetic-saved-baseline",
          mediaType: "application/json",
          previewable: true,
        },
      });
    if (url.pathname.endsWith("/content"))
      return route.fulfill({
        body,
        contentType: "application/json",
        headers: { "x-workspace-revision": "synthetic-saved-baseline" },
      });
    return route.fallback();
  });
  await page.route(
    "**/api/plugins/pythia-research-visuals/widgets**",
    async (route) => {
      const url = new URL(route.request().url());
      if (
        route.request().method() === "GET" &&
        url.pathname === "/api/plugins/pythia-research-visuals/widgets"
      ) {
        descriptorReads += 1;
        if (denyRenderer)
          return route.fulfill({
            status: 403,
            json: { error: { message: "Synthetic renderer access denied." } },
          });
        if (!busyResponseCompleted) {
          await route.fulfill({
            status: 429,
            json: { error: { message: "Synthetic native reader busy." } },
          });
          const response = await route.request().response();
          // Strict Mode can abort the initial read. Keep returning busy until
          // one response actually completes, so cancellation cannot bypass it.
          if (response && (await response.finished()) === null)
            busyResponseCompleted = true;
          return;
        }
      }
      if (
        route.request().method() === "GET" &&
        [
          "/api/plugins/pythia-research-visuals/widgets",
          "/api/plugins/pythia-research-visuals/widgets/research-visual",
        ].includes(url.pathname)
      )
        return route.continue();
      return route.fallback();
    },
  );
  chat.setHistory([
    {
      id: "synthetic-visual-answer",
      role: "assistant",
      content: `[Synthetic growth scenario](/workspace/${path})`,
    },
  ]);
  await page.reload();

  const card = page.locator('[data-slot="chat-visual"]');
  await expect(card).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator('[data-slot="widget-host"]')).toHaveCount(0);
  const open = card.getByRole("link");
  await open.focus();
  await expect(open).toBeFocused();
  await page.keyboard.press("Enter");

  const companion = page.locator('[data-slot="workspace-companion"]');
  const visual = companion.locator('[data-slot="research-visual"]');
  const toolbar = companion.locator('[data-slot="workspace-toolbar"]');
  const growth = visual.getByRole("slider", { name: /Revenue growth/ });
  const canvas = visual.locator("canvas").first();
  await expect(visual).toBeVisible();
  await expect(growth).toHaveValue("10");
  await expect(canvas).toBeVisible();
  // The initial busy read recovers without a user-triggered retry; the module
  // and every subsequent successful descriptor still come from native Hermes.
  expect(descriptorReads).toBeGreaterThanOrEqual(2);
  expect(busyResponseCompleted).toBe(true);
  await expect(page).toHaveURL(/\/c\/synthetic-chat$/);
  await expect(
    visual.getByRole("tab", { name: "Data", exact: true }),
  ).toHaveCount(0);
  await expect(visual.getByRole("button", { name: /About/ })).toHaveCount(0);
  await expect(visual.locator("footer")).toContainText("Invented revenue");
  await expect(visual.locator("footer")).toContainText(
    artifact.data.assumptions.join(" "),
  );
  await expect(visual.locator("footer")).toContainText(artifact.data.asOf);
  await expect(
    toolbar.getByRole("button", { name: "Actions", exact: true }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "View source", exact: true }),
  ).toBeVisible();

  const baseline = await canvas.evaluate((element: HTMLCanvasElement) =>
    element.toDataURL(),
  );
  await growth.focus();
  await page.keyboard.press("ArrowRight");
  await expect(growth).toBeFocused();
  await expect(growth).toHaveValue("11");
  await expect
    .poll(() =>
      canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL()),
    )
    .not.toBe(baseline);

  const actions = toolbar.getByRole("button", { name: "Actions", exact: true });
  await actions.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await page.keyboard.press("Enter");
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export SVG", exact: true }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe("research-visual.svg");
  const svgPath = await svg.path();
  if (!svgPath) throw new Error("SVG download did not produce a file");
  expect(await readFile(svgPath, "utf8")).toContain("<svg");
  await actions.click();
  const scenarioDownload = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download scenario", exact: true })
    .click();
  const scenario = await scenarioDownload;
  const scenarioPath = await scenario.path();
  if (!scenarioPath)
    throw new Error("Scenario download did not produce a file");
  expect(JSON.parse(await readFile(scenarioPath, "utf8"))).toMatchObject({
    ...artifact,
    data: { ...artifact.data, parameters: { growth: 11 } },
  });

  await toolbar
    .getByRole("button", { name: "View source", exact: true })
    .click();
  await expect(
    companion.getByRole("region", { name: "Source code" }),
  ).toBeVisible();
  await expect(growth).toBeHidden();
  await toolbar
    .getByRole("button", { name: "Show visual", exact: true })
    .click();
  await expect(growth).toHaveValue("11");
  await expect(canvas).toBeVisible();

  await companion
    .getByRole("button", {
      name: "Close synthetic-growth.pythia-visual.json",
      exact: true,
    })
    .click();
  await expect(companion).toHaveCount(0);
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(growth).toHaveValue("10");
  await expect(canvas).toBeVisible();

  await companion
    .getByRole("button", {
      name: "Close synthetic-growth.pythia-visual.json",
      exact: true,
    })
    .click();
  await expect(companion).toHaveCount(0);
  denyRenderer = true;
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(
    companion.getByRole("button", { name: "Retry renderer", exact: true }),
  ).toBeVisible();
  await expect(companion.locator('[data-slot="widget-host"]')).toHaveCount(0);
  await expect(companion.locator("canvas")).toHaveCount(0);
  await toolbar
    .getByRole("button", { name: "View source", exact: true })
    .click();
  await expect(
    companion.getByRole("region", { name: "Source code" }),
  ).toContainText(artifact.title);
  expect(chat.submissions).toEqual([]);
  expect(chat.unexpected).toEqual([]);
});
