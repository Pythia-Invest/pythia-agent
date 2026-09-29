import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("keeps unknown agents visible and finished outcomes inspectable", async ({
  page,
}) => {
  // The selected child is polled; advance the page clock past its interval.
  await page.clock.install();
  const f = await fixture(page);
  f.setWork({
    plans: [],
    assignments: [],
    offset: 0,
    historyMore: false,
    agentsMore: false,
    agents: [
      {
        id: "failed",
        sessionId: "failed",
        goal: "Check unavailable source",
        status: "failed",
      },
      {
        id: "unknown",
        sessionId: "unknown",
        goal: "Check source dates",
        status: "unknown",
      },
      {
        id: "stopped",
        sessionId: "stopped",
        goal: "Compare prices",
        status: "stopped",
      },
      {
        id: "ended",
        sessionId: "ended",
        goal: "Check archived records",
        status: "ended",
      },
    ],
  });
  f.setAgentPage({
    assignment: "Check source dates",
    ended: false,
    messages: [],
    offset: 0,
    more: false,
  });
  await send(page);
  const start = (id: string, goal: string) => ({
    event: "subagent.start",
    child_session_id: id,
    goal,
  });
  await f.emit([
    start("failed", "Check unavailable source"),
    start("unknown", "Check source dates"),
    start("stopped", "Compare prices"),
    start("ended", "Check archived records"),
    { event: "subagent.complete", child_session_id: "failed", status: "error" },
    {
      event: "subagent.complete",
      child_session_id: "stopped",
      status: "interrupted",
    },
    { event: "subagent.complete", child_session_id: "ended" },
    { event: "run.completed", output: "Parent finished." },
  ]);
  // The finished turn's record lists its agents with their own outcomes.
  await page.getByRole("button", { name: /^Worked/ }).click();
  const record = page.locator('[data-slot="activity-list"]');
  await expect(
    record.getByText("Asked 4 research agents to help"),
  ).toBeVisible();
  const row = (name: RegExp) => record.getByRole("button", { name });
  await expect(record.getByRole("button")).toHaveCount(4);
  await expect(
    row(/Check unavailable source/).getByRole("img", { name: "Failed" }),
  ).toBeVisible();
  await expect(
    row(/Compare prices/).getByRole("img", { name: "Stopped" }),
  ).toBeVisible();
  await expect(
    row(/Check archived records/).getByRole("img", { name: "Ended" }),
  ).toBeVisible();
  // A parent ending proves nothing about a child that never reported back.
  await expect(
    row(/Check source dates/).getByRole("img", { name: "Status unknown" }),
  ).toBeVisible();
  await row(/Check source dates/).click();
  const detail = page.getByRole("region", {
    name: "Research agent conversation",
  });
  await expect(
    detail.getByRole("img", { name: "Status unknown" }),
  ).toBeVisible();
  await expect(
    detail.getByText("Research agent · status unknown"),
  ).toBeVisible();
  f.setAgentPage({
    assignment: "Check source dates",
    ended: false,
    offset: 0,
    more: false,
    messages: [
      {
        id: "partial",
        role: "assistant",
        parts: [{ type: "text", text: "Checking publication dates." }],
      },
    ],
  });
  await page.clock.runFor(2_000);
  await expect(detail.getByText("Checking publication dates.")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Copy answer" })).toHaveCount(
    0,
  );
  await expect(detail.getByRole("textbox")).toHaveCount(0);
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await expect(detail).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Main conversation" }),
  ).toBeVisible();
  // An ended child that answered reads as finished.
  f.setAgentPage(
    {
      assignment: "Check archived records",
      ended: true,
      offset: 0,
      more: false,
      messages: [
        {
          id: "archived",
          role: "assistant",
          parts: [{ type: "text", text: "Archived records checked." }],
        },
      ],
    },
    "ended",
  );
  await page.getByRole("button", { name: /^Worked/ }).click();
  await row(/Check archived records/).click();
  await expect(detail.getByText("Research agent · finished")).toBeVisible();
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});

test("keeps the assignment visible through loading and failed reads, then retries", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  let fail = true;
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    requested = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/work?child=child&offset=0", async (route) => {
    if (!fail) return route.fallback();
    requested();
    await pending;
    return route.fulfill({
      status: 404,
      json: { error: { message: "Saved session unavailable" } },
    });
  });
  await f.emit([
    {
      event: "subagent.start",
      child_session_id: "child",
      goal: "Verify source coverage",
    },
  ]);
  await page
    .locator('[data-slot="turn-live-detail"]')
    .getByRole("button", { name: /Verify source coverage/ })
    .click();
  await requestStarted;
  const detail = page.getByRole("region", {
    name: "Research agent conversation",
  });
  await expect(
    detail.getByRole("status").filter({
      hasText: "Loading the agent's conversation",
    }),
  ).toBeAttached();
  await expect(
    detail.locator('[data-role="user"]').getByText("Verify source coverage"),
  ).toBeVisible();
  release();
  await expect(
    detail.getByText("This conversation couldn't be refreshed."),
  ).toBeVisible();
  fail = false;
  await detail.getByRole("button", { name: "Try again" }).click();
  await expect(
    detail.getByText("This conversation couldn't be refreshed."),
  ).toHaveCount(0);
  // Until the child saves a step, its turn shows the same working line.
  await expect(
    detail.locator('[data-slot="turn-activity"][data-state="live"]'),
  ).toBeVisible();
  await expect(
    detail.locator('[data-role="user"]').getByText("Verify source coverage"),
  ).toBeVisible();
  expect(f.unexpected).toEqual([]);
});
