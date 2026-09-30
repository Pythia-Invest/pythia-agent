import { expect, test } from "@playwright/test";
import { japanesePdfBytes } from "../test/workspace-pdf-fixtures";
import { fixture, isPhone } from "./stream-fixture";
import {
  documentBytes,
  pdfBytes,
  workbookBytes,
} from "../test/workspace-format-fixtures";
import type { WorkspaceEntry } from "../src/workspace/types";

const encode = (text: string) => new TextEncoder().encode(text).buffer;
const samples = [
  {
    name: "model.mjs",
    kind: "text",
    bytes: encode('export const revenue = 120;\nconsole.log("fictional");'),
  },
  {
    name: "engine.rs",
    kind: "text",
    bytes: encode('fn main() { println!("fictional"); }'),
  },
  { name: "model.xlsx", kind: "spreadsheet", bytes: workbookBytes() },
  { name: "long.docx", kind: "document", bytes: documentBytes(80) },
  {
    name: "long.md",
    kind: "markdown",
    bytes: encode(
      `${Array.from(
        { length: 300 },
        (_, i) => `Paragraph ${i + 1}: fictional research and assumptions.\n\n`,
      ).join("")}![Local chart](chart.png)`,
    ),
  },
  {
    name: "long.ipynb",
    kind: "notebook",
    bytes: encode(
      JSON.stringify({
        nbformat: 4,
        cells: Array.from({ length: 50 }, (_, i) => ({
          cell_type: "markdown",
          source: `## Research ${i + 1}\n\nFictional assumptions and results.`,
        })),
      }),
    ),
  },
  { name: "research.pdf", kind: "pdf", bytes: pdfBytes() },
  { name: "japanese.pdf", kind: "pdf", bytes: japanesePdfBytes() },
  {
    name: "large.csv",
    kind: "csv",
    bytes: encode(
      Array.from({ length: 250 }, (_, i) => `Row ${i + 1},${i}`).join("\n"),
    ),
  },
  {
    name: "analysis.ipynb",
    kind: "notebook",
    bytes: encode(
      JSON.stringify({
        nbformat: 4,
        cells: [
          { cell_type: "markdown", source: ["# Saved research"] },
          {
            cell_type: "code",
            execution_count: 7,
            source: ["print(120)"],
            outputs: [
              {
                data: {
                  "text/plain": "120",
                  "text/html": '<img src="https://example.invalid/tracker">',
                },
              },
            ],
          },
        ],
      }),
    ),
  },
] as const;
async function setup(page: import("@playwright/test").Page, name: string) {
  await fixture(page);
  await page.route("**/api/workspace/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    const sample = samples.find((s) => s.name === path);
    const entry = (value: (typeof samples)[number]): WorkspaceEntry => ({
      path: value.name,
      name: value.name,
      kind: value.kind,
      size: value.bytes.byteLength,
      modified: "2026-01-01",
      revision: "fixture-1",
      mediaType: "application/octet-stream",
      previewable: true,
    });
    if (url.pathname.endsWith("/entry"))
      return route.fulfill({
        json: sample
          ? entry(sample)
          : {
              path: "",
              name: "Workspace",
              kind: "directory",
              size: 0,
              revision: "fixture-1",
            },
      });
    if (url.pathname.endsWith("/list"))
      return route.fulfill({
        json: {
          entries: samples.map(entry),
          partial: false,
          scanned: samples.length,
        },
      });
    if (url.pathname.endsWith("/content") && sample) {
      const bytes = Buffer.from(sample.bytes);
      const range = route
        .request()
        .headers()
        .range?.match(/^bytes=(\d+)-(\d+)$/);
      const start = Number(range?.[1] ?? 0),
        end = Math.min(
          Number(range?.[2] ?? bytes.length - 1),
          bytes.length - 1,
        );
      return route.fulfill({
        status: range ? 206 : 200,
        body: bytes.subarray(start, end + 1),
        headers: {
          "content-type":
            sample.kind === "pdf"
              ? "application/pdf"
              : "application/octet-stream",
          "content-disposition": "inline",
          "x-workspace-revision": "fixture-1",
          "accept-ranges": "bytes",
          ...(range
            ? { "content-range": `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { message: "Missing synthetic file" } },
    });
  });
  await page.goto("/workspace");
  await page
    .locator('[data-slot="workspace-directory"]')
    .getByRole("link", { name, exact: true })
    .click();
}

async function openFile(page: import("@playwright/test").Page, name: string) {
  if (isPhone(page)) await page.keyboard.press("Escape");
  await page
    .locator('[data-slot="workspace-directory"]')
    .getByRole("link", { name, exact: true })
    .click();
}
async function switchFile(page: import("@playwright/test").Page, name: string) {
  // A phone has no file tabs: it reopens the file from the list.
  if (isPhone(page)) return openFile(page, name);
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole("button", { name: /more open files?$/ }).click();
    await page
      .locator('[data-slot="popover-popup"]')
      .getByTitle(name, { exact: true })
      .click();
  }
}

async function scrollReader(page: import("@playwright/test").Page) {
  // Let the native scroll event reach the reader before dismissing its drawer.
  await page.locator('[data-slot="workspace-reader-scroll"]').evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        el.addEventListener(
          "scroll",
          () => requestAnimationFrame(() => resolve()),
          {
            once: true,
          },
        );
        el.scrollTop = 700;
      }),
  );
}

for (const { name, text, language } of [
  { name: "model.mjs", text: "export const revenue", language: "javascript" },
  { name: "engine.rs", text: "fn main()", language: "rust" },
])
  test(`highlights ${name} without running it`, async ({ page }) => {
    await setup(page, name);
    const code = page.locator('[data-slot="workspace-code"]');
    await expect(code).toContainText(text);
    await expect(code.locator("span[style]").first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Code tools" })).toContainText(
      language,
    );
    await expect(
      page.getByRole("region", { name: "Source code" }),
    ).toContainText(text);
    // model.mjs declares `revenue`; previewing it must not run it.
    expect(await page.evaluate(() => "revenue" in window)).toBe(false);
  });
test("notebooks show saved cells and never fetch HTML output resources", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("example.invalid")) external.push(r.url());
  });
  await setup(page, "analysis.ipynb");
  await expect(page.locator('[data-slot="workspace-notebook"]')).toContainText(
    "Saved research",
  );
  await expect(page.locator('[data-slot="workspace-notebook"]')).toContainText(
    "120",
  );
  await expect(
    page.locator('[data-slot="workspace-notebook-prompt"]'),
  ).toHaveText("[7]:");
  expect(external).toEqual([]);
});
test("PDF renders pages locally with navigation and zoom", async ({ page }) => {
  await setup(page, "research.pdf");
  await expect(page.locator('[data-slot="workspace-pdf"]')).toContainText(
    "Page 1 of 2",
  );
  const canvas = page.locator('[data-slot="workspace-pdf"] canvas');
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const data = c
          .getContext("2d")
          ?.getImageData(0, 0, c.width, c.height).data;
        return Boolean(data?.some((value, i) => i % 4 === 3 && value > 0));
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-pdf"]')).toContainText(
    "Page 2 of 2",
  );
  const tools = page.getByRole("group", { name: "PDF tools" });
  await tools.getByRole("spinbutton", { name: "Page number" }).fill("1");
  await expect(tools).toContainText("Page 1 of 2");
  await tools.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(tools).toContainText("125%");
  await tools.getByRole("button", { name: "Fit width", exact: true }).click();
  await expect(tools).toContainText("100%");
  await page.getByRole("button", { name: "Text view", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-pdf"] pre')).toContainText(
    "Fictional PDF research",
  );
});

test("PDF character maps load locally and preserve non-Latin text", async ({
  page,
}) => {
  await setup(page, "japanese.pdf");
  await page.getByRole("button", { name: "Text view", exact: true }).click();
  await expect(page.locator('[data-slot="workspace-pdf"] pre')).toContainText(
    "日本",
  );
});
test("file tabs restore PDF, worksheet and row-page positions", async ({
  page,
}) => {
  await setup(page, "research.pdf");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await openFile(page, "model.xlsx");
  await page.getByRole("combobox", { name: "Worksheet" }).selectOption("1");
  await openFile(page, "large.csv");
  await page.getByRole("button", { name: "Next rows", exact: true }).click();
  await switchFile(page, "research.pdf");
  await expect(
    page.getByRole("spinbutton", { name: "Page number" }),
  ).toHaveValue("2");
  await switchFile(page, "model.xlsx");
  await expect(page.getByRole("combobox", { name: "Worksheet" })).toHaveValue(
    "1",
  );
  await switchFile(page, "large.csv");
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "Page 2 of 3",
  );
});

for (const name of ["long.docx", "long.ipynb"]) {
  test(`restores ${name} scroll after worker content is ready`, async ({
    page,
  }) => {
    await setup(page, name);
    const scroll = page.locator('[data-slot="workspace-reader-scroll"]');
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollHeight))
      .toBeGreaterThan(1500);
    await scrollReader(page);
    await openFile(page, "model.mjs");
    await switchFile(page, name);
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(700);
  });
}

test("offscreen lazy images do not block document scroll restoration", async ({
  page,
}) => {
  await setup(page, "long.md");
  const scroll = page.locator('[data-slot="workspace-reader-scroll"]');
  const image = scroll.getByRole("img", { name: "Local chart" });
  await expect(image).toHaveAttribute("loading", "lazy");
  expect(await image.evaluate((el: HTMLImageElement) => el.complete)).toBe(
    false,
  );
  await scrollReader(page);
  await openFile(page, "model.mjs");
  await switchFile(page, "long.md");
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(700);
  expect(await image.evaluate((el: HTMLImageElement) => el.complete)).toBe(
    false,
  );
});
