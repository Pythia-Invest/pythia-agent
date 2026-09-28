import { expect, test } from "@playwright/test";
import type { HermesMessage } from "../src/server/types";
import { fixture, send } from "./stream-fixture";

test("reconciles a long turn despite a later background answer", async ({
  page,
}) => {
  const f = await fixture(page);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "warning" &&
      message.text().includes("completed-history")
    )
      warnings.push(message.text());
  });
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "web_search", preview: "Example research" },
  ]);
  const history: HermesMessage[] = [
    { id: "u", role: "user", content: "Check the synthetic example." },
    ...Array.from({ length: 60 }, (_, index) => [
      {
        id: `a-${index}`,
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: `call-${index}`,
            function: { name: "web_search", arguments: '{"query":"Example"}' },
          },
        ],
      },
      {
        id: `t-${index}`,
        role: "tool",
        tool_call_id: `call-${index}`,
        content: '{"results":[]}',
      },
    ]).flat(),
    {
      id: "answer",
      role: "assistant",
      content: "## Findings\n\nThe research is **complete**.",
    },
    { id: "background", role: "user", content: "Background task finished" },
    { id: "followup", role: "assistant", content: "A later native answer." },
  ];
  f.setHistory(history);
  await f.emit([
    {
      event: "run.completed",
      output: "## Findings\n\nThe research is **complete**.",
    },
  ]);
  const disclosure = page.getByRole("button", { name: /^Worked/ });
  await expect(disclosure).toBeVisible();
  await disclosure.click();
  await expect(
    page.locator('[data-slot="activity-row"][data-state="completed"]'),
  ).toHaveCount(60);
  await expect(page.getByText(/some results unavailable/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Findings" })).toBeAttached();
  await expect(page.locator('[data-streamdown="strong"]')).toHaveText(
    "complete",
  );
  expect(warnings).toEqual([]);
  expect(f.unexpected).toEqual([]);
});

test("describes research agent controls during streaming", async ({ page }) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "delegate_task", preview: "list" },
  ]);
  const status = page.locator(
    '[data-slot="turn-activity"][data-state="live"] [data-slot="turn-status"]',
  );
  await expect(status).toHaveText("Checking research agents");
  await f.emit([
    { event: "tool.completed", tool: "delegate_task", duration: 0.1 },
    {
      event: "tool.started",
      tool: "delegate_task",
      preview: "stop sa-1-example",
    },
  ]);
  await expect(status).toHaveText("Stopping a research agent");
  await expect(page.getByText(/Delegated list|sa-1-example/)).toHaveCount(0);
  await f.emit([{ event: "run.cancelled" }]);
  expect(f.unexpected).toEqual([]);
});

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

test("keeps opened activity open and preserves the reading position after an upward gesture", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit(
    Array.from({ length: 25 }, (_, index) => ({
      event: "reasoning.available",
      text: `Reviewing synthetic source ${index + 1}`,
    })),
  );
  const activity = page.locator('[data-slot="turn-activity"]');
  const toggle = activity.getByRole("button");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    activity.getByText("Reviewing synthetic source 25", { exact: true }),
  ).toBeVisible();
  const viewport = page.locator('[data-slot="conversation"]');
  await viewport.dispatchEvent("wheel", { deltaY: -12 });
  await viewport.evaluate((element) => {
    element.scrollTop = 20;
    element.dispatchEvent(new Event("scroll"));
  });
  const before = await viewport.evaluate((element) => element.scrollTop);
  await f.emit([
    { event: "message.delta", delta: "The answer starts while I am reading." },
  ]);
  await expect(page.locator('[data-slot="assistant-prose"]')).toHaveText(
    "The answer starts while I am reading.",
  );
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(before + 1);
  await f.emit([
    { event: "run.completed", output: "The answer starts while I am reading." },
  ]);
  await expect(toggle).toHaveText(/^Worked for/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(f.unexpected).toEqual([]);
});
