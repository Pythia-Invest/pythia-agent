import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("creates the first chat without locking its automatic title", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.goto("/");
  const created = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/sessions" &&
      request.method() === "POST",
  );
  await send(page);
  expect((await created).postDataJSON()).toEqual({});
  await expect.poll(() => f.submissions.length).toBe(1);
  await f.emit([{ event: "run.cancelled" }]);
  expect(f.unexpected).toEqual([]);
});

test("settles activity at the first prose token and preserves the answer DOM on completion", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "example.md" },
  ]);
  const activity = page.locator('[data-slot="turn-activity"]');
  const toggle = activity.getByRole("button");
  await expect(activity).toHaveAttribute("data-state", "live");
  await expect(toggle).toHaveText("Reading example.md");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await f.emit([
    { event: "tool.completed", tool: "read_file", duration: 1 },
    { event: "message.delta", delta: "A stable answer" },
  ]);
  await expect(activity).toHaveAttribute("data-state", "settled");
  await expect(toggle).toHaveText(/^Worked for \d+s$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const prose = page.locator('[data-slot="assistant-prose"]');
  await expect(prose).toHaveText("A stable answer");
  await expect(activity.locator('[data-slot="assistant-prose"]')).toHaveCount(
    0,
  );
  const original = await prose.elementHandle();
  await f.emit([{ event: "message.delta", delta: "." }]);
  await expect(prose).toHaveText("A stable answer.");
  await f.emit([{ event: "run.completed", output: "A stable answer." }]);
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();
  expect(await original?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(prose).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(f.unexpected).toEqual([]);
});

test("does not reopen activity when tools resume and respects manual inspection", async ({
  page,
}) => {
  const f = await fixture(page, [
    {
      id: "earlier-answer",
      role: "assistant",
      content: Array.from(
        { length: 40 },
        (_, index) => `Earlier finding ${index + 1}.`,
      ).join("\n\n"),
    },
  ]);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "first.md" },
  ]);
  const activity = page.locator('[data-slot="turn-activity"]').last();
  const toggle = activity.getByRole("button").first();
  await expect(toggle).toHaveText("Reading first.md");
  await f.emit([
    { event: "tool.completed", tool: "read_file", duration: 1 },
    { event: "message.delta", delta: "I found the first source." },
  ]);
  await expect(activity).toHaveAttribute("data-state", "settled");
  await f.emit([
    { event: "tool.started", tool: "web_search", preview: "second source" },
  ]);
  // Renewed work brings the live line back without opening the record.
  await expect(activity).toHaveAttribute("data-state", "live");
  await expect(toggle).toHaveText("Searching the web");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-slot="assistant-prose"]').last()).toHaveText(
    "I found the first source.",
  );
  const viewport = page.locator('[data-slot="conversation"]');
  const beforeExpansion = await viewport.evaluate(
    (element) => element.scrollTop,
  );
  expect(beforeExpansion).toBeGreaterThan(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(beforeExpansion + 1);
  await expect(
    activity.getByText("Searching the web for “second source”", {
      exact: true,
    }),
  ).toBeVisible();
  await f.emit([
    { event: "tool.completed", tool: "web_search", duration: 1 },
    { event: "message.delta", delta: "The final finding." },
  ]);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await f.emit([{ event: "run.completed", output: "The final finding." }]);
  await expect(toggle).toHaveText(/^Worked for/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(f.unexpected).toEqual([]);
});
