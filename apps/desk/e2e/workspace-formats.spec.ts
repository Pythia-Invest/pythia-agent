import { expect, test } from "@playwright/test";
import { fixture } from "./stream-fixture";
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
  {
    name: "data.csv",
    kind: "csv",
    bytes: encode('Code,Revenue\n00123,"120,000"\n=1+2,90'),
  },
  { name: "model.xlsx", kind: "spreadsheet", bytes: workbookBytes() },
  { name: "memo.docx", kind: "document", bytes: documentBytes() },
  { name: "research.pdf", kind: "pdf", bytes: pdfBytes() },
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

test("highlights JavaScript without running it", async ({ page }) => {
  await setup(page, "model.mjs");
  await expect(page.locator('[data-slot="workspace-code"]')).toContainText(
    "export const revenue",
  );
  await expect(
    page.locator('[data-slot="workspace-code"] span[style]').first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("group", { name: "Code tools" })).toContainText(
    "javascript",
  );
  await expect(page.getByRole("region", { name: "Source code" })).toContainText(
    "export const revenue",
  );
  expect(await page.evaluate(() => "revenue" in window)).toBe(false);
});
test("highlights Rust using the same preview", async ({ page }) => {
  await setup(page, "engine.rs");
  await expect(page.locator('[data-slot="workspace-code"]')).toContainText(
    "fn main()",
  );
  await expect(
    page.locator('[data-slot="workspace-code"] span[style]').first(),
  ).toBeVisible({ timeout: 30000 });
});
test("CSV preserves identifier strings and quoted cells", async ({ page }) => {
  await setup(page, "data.csv");
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "00123",
    { timeout: 30000 },
  );
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "120,000",
  );
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "=1+2",
  );
});
test("Excel previews formatted values and switches worksheets", async ({
  page,
}) => {
  await setup(page, "model.xlsx");
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "20.0%",
    { timeout: 30000 },
  );
  await page.getByRole("combobox", { name: "Worksheet" }).selectOption("1");
  await expect(page.locator('[data-slot="workspace-table"]')).toContainText(
    "Fictional data",
  );
});
test("DOCX renders readable paragraphs and tables", async ({ page }) => {
  await setup(page, "memo.docx");
  await expect(page.locator('[data-slot="workspace-document"]')).toContainText(
    "Fictional investment memo",
    { timeout: 30000 },
  );
  await expect(
    page.locator('[data-slot="workspace-document"] table'),
  ).toContainText("Revenue");
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
    { timeout: 30000 },
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
    { timeout: 30000 },
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
