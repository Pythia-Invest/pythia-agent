import { expect, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

test("desktop navigation reserves its width before hydration", async ({
  page,
  browser,
}) => {
  await fixture(page);
  await page.goto("/");
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
  });
  try {
    const initial = await context.newPage();
    await initial.goto(new URL("/", page.url()).href);
    const rail = initial.getByRole("complementary", {
      name: "Desk navigation",
    });
    if ((page.viewportSize()?.width ?? 0) < 900) {
      await expect(rail).toHaveCount(0);
    } else {
      await expect(rail).toBeVisible();
      const before = await rail.boundingBox();
      const after = await page
        .getByRole("complementary", { name: "Desk navigation" })
        .boundingBox();
      expect(before?.width).toBe(after?.width);
      expect(before?.x).toBe(after?.x);
    }
  } finally {
    await context.close();
  }
});

test("the empty opening stays centered within its column as the composer grows", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Pythia" });
  await expect(input).toBeVisible();
  for (const text of [
    "",
    Array.from({ length: 10 }, () => "A longer research question").join("\n"),
  ]) {
    await input.fill(text);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const area = document
            .querySelector('[data-slot="chat-opening-layout"]')
            ?.getBoundingClientRect();
          const content = document
            .querySelector('[data-slot="chat-opening-content"]')
            ?.getBoundingClientRect();
          if (!area || !content) return Number.POSITIVE_INFINITY;
          return Math.max(
            Math.abs(content.x + content.width / 2 - area.x - area.width / 2),
            Math.abs(content.y + content.height / 2 - area.y - area.height / 2),
          );
        }),
      )
      .toBeLessThan(2);
  }
});

test("user bubbles align right while replies and persistent actions share the left edge", async ({
  page,
}) => {
  await fixture(page, [
    { id: "u1", role: "user", content: "First question" },
    {
      id: "a1",
      role: "assistant",
      content: "First answer with [evidence](https://example.com/first).",
    },
    {
      id: "note",
      role: "user",
      display_kind: "model_switch",
      content: "Synthetic switch",
    },
    { id: "u2", role: "user", content: "Second question" },
    { id: "a2", role: "assistant", content: "Second answer." },
  ]);
  const first = page.locator('[data-role="assistant"]').first();
  const actions = first.locator('[data-slot="answer-actions"]');
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCSS("opacity", "1");
  const bubble = await page.locator('[data-role="user"]').first().boundingBox();
  const reply = await first.boundingBox();
  const bar = await actions.boundingBox();
  if (!bubble || !reply || !bar) throw new Error("Transcript geometry missing");
  expect(bubble.x).toBeGreaterThan(reply.x);
  expect(bubble.x + bubble.width).toBeCloseTo(reply.x + reply.width, 0);
  expect(bar.x).toBeGreaterThanOrEqual(reply.x);
  await expect(page.locator('[data-role="system"]')).toHaveCSS(
    "text-align",
    "start",
  );
  await actions.getByRole("button", { name: "1 source" }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: /evidence/ }),
  ).toHaveAttribute("href", "https://example.com/first");
});
