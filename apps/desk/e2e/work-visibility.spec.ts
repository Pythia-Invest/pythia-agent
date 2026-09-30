import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("shows the latest native plan and inspects a running child without another event subscription", async ({
  page,
}) => {
  // The selected child is polled; advance the page clock past its interval.
  await page.clock.install();
  const f = await fixture(page);
  await send(page);
  f.setWork({
    offset: 0,
    agentsMore: false,
    historyMore: false,
    agents: [],
    assignments: [
      { goal: "Verify source coverage", context: "Use primary documentation." },
    ],
    plans: [
      {
        id: "plan-1",
        revision: 1,
        items: [
          { id: "a", content: "Find candidate sources", status: "in_progress" },
          { id: "b", content: "Compare prices", status: "pending" },
        ],
      },
      {
        id: "plan-2",
        revision: 2,
        items: [
          { id: "a", content: "Find candidate sources", status: "completed" },
          { id: "c", content: "Verify coverage", status: "in_progress" },
        ],
      },
    ],
  });
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
    {
      event: "subagent.start",
      child_session_id: "child",
      goal: "Verify source coverage",
      subagent_id: "internal-id",
    },
  ]);
  // The latest snapshot replaces the earlier one, in native order and state.
  const live = page.locator('[data-slot="turn-live-detail"]');
  const plan = live.locator('[data-slot="turn-plan"]');
  await expect(plan.getByRole("listitem")).toHaveCount(2);
  await expect(
    plan
      .locator('[data-state="completed"]')
      .getByText("Find candidate sources"),
  ).toBeVisible();
  await expect(
    plan.locator('[data-state="in_progress"]').getByText("Verify coverage"),
  ).toBeVisible();
  await expect(plan.getByText("Compare prices")).toHaveCount(0);
  f.setAgentPage({
    assignment: "Verify source coverage",
    assignmentId: "child-assignment",
    ended: false,
    offset: 0,
    more: false,
    messages: [
      {
        id: "child-assignment",
        role: "user",
        parts: [{ type: "text", text: "Verify source coverage" }],
      },
      {
        id: "child-message",
        role: "assistant",
        parts: [
          { type: "text", text: "I am checking the primary documentation." },
          {
            type: "dynamic-tool",
            toolCallId: "child-tool",
            toolName: "read_file",
            input: { path: "coverage.md" },
            state: "input-available",
          },
        ],
      },
    ],
  });
  // While Pythia works, its agents sit under the live line.
  await expect(live.getByRole("img", { name: "Working" })).toBeVisible();
  await live.getByRole("button", { name: /Verify source coverage/ }).click();
  const detail = page.getByRole("region", {
    name: "Research agent conversation",
  });
  await expect(detail).toBeVisible();
  // The native assignment row is shown once, as the child's task.
  await expect(detail.locator('[data-role="user"]')).toHaveCount(1);
  await expect(
    detail.locator('[data-role="user"]').getByText("Task", { exact: true }),
  ).toBeVisible();
  await expect(detail.getByRole("textbox")).toHaveCount(0);
  const childActivity = detail.locator('[data-slot="turn-activity"]');
  await expect(childActivity).toHaveAttribute("data-state", "live");
  await expect(childActivity.getByRole("button").first()).toHaveText(
    "Reading coverage.md",
  );
  await detail.getByText("Background it was given").click();
  await expect(detail.getByText("Use primary documentation.")).toBeVisible();
  expect(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  // Between saved steps the child is still working: its notes are not an
  // answer, and the line stays live rather than saying it worked.
  f.setAgentPage({
    assignment: "Verify source coverage",
    assignmentId: "child-assignment",
    ended: false,
    offset: 0,
    more: false,
    messages: [
      {
        id: "child-assignment",
        role: "user",
        parts: [{ type: "text", text: "Verify source coverage" }],
      },
      {
        id: "child-message",
        role: "assistant",
        parts: [
          { type: "text", text: "I am checking the primary documentation." },
          {
            type: "dynamic-tool",
            toolCallId: "child-tool",
            toolName: "read_file",
            input: { path: "coverage.md" },
            state: "output-available",
            output: "Synthetic coverage",
          },
        ],
      },
    ],
  });
  await page.clock.runFor(5_000);
  await expect(childActivity.getByRole("button").first()).toHaveText(
    "Thinking",
  );
  await expect(childActivity).toHaveAttribute("data-state", "live");
  await expect(detail.locator('[data-slot="assistant-prose"]')).toHaveCount(0);
  // A background completion still updates the selected child after its launch call finished.
  f.setAgentPage({
    assignment: "Verify source coverage",
    assignmentId: "child-assignment",
    ended: true,
    offset: 0,
    more: false,
    messages: [
      {
        id: "child-assignment",
        role: "user",
        parts: [{ type: "text", text: "Verify source coverage" }],
      },
      {
        id: "child-message",
        role: "assistant",
        parts: [
          { type: "text", text: "I am checking the primary documentation." },
          {
            type: "dynamic-tool",
            toolCallId: "child-tool",
            toolName: "read_file",
            input: { path: "coverage.md" },
            state: "output-available",
            output: "Synthetic coverage",
          },
          {
            type: "text",
            text: "**Coverage verified.**\n\n- Primary sources agree.\n- Dates match.",
          },
        ],
      },
    ],
  });
  await f.emit([
    { event: "tool.completed", tool: "delegate_task" },
    {
      event: "subagent.complete",
      child_session_id: "child",
      status: "completed",
    },
  ]);
  await expect(
    detail
      .locator('[data-streamdown="strong"]')
      .filter({ hasText: "Coverage verified." }),
  ).toBeVisible();
  await expect(
    detail.getByRole("listitem").filter({ hasText: "Primary sources agree." }),
  ).toBeVisible();
  const worked = detail.getByRole("button", { name: /^Worked/ });
  await expect(worked).toHaveAttribute("aria-expanded", "false");
  await worked.click();
  await expect(detail.getByText("Read coverage.md")).toBeVisible();
  await expect(
    detail.getByText("I am checking the primary documentation."),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await expect(detail).toHaveCount(0);
  await f.emit([{ event: "run.completed", output: "Sources compared." }]);
  await expect(
    page.getByText("Sources compared.", { exact: true }),
  ).toBeVisible();
  // The finished child stays reachable from the turn's record.
  await page.getByRole("button", { name: /^Worked/ }).click();
  const record = page.locator('[data-slot="activity-list"]');
  await expect(record.getByRole("img", { name: "Working" })).toHaveCount(0);
  await record.getByRole("button", { name: /Verify source coverage/ }).click();
  await expect(
    detail.getByText("Coverage verified.", { exact: true }),
  ).toBeVisible();
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});
