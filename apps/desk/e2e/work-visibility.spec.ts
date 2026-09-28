import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("removes a cleared plan until a new plan is saved", async ({ page }) => {
  const f = await fixture(page);
  await send(page);
  const initial = {
    id: "plan-created",
    revision: 1,
    items: [{ id: "a", content: "Check sources", status: "pending" as const }],
  };
  f.setWork({
    plans: [initial],
    agents: [],
    assignments: [],
    offset: 0,
    historyMore: true,
    agentsMore: false,
  });
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
  ]);
  // While Pythia works, its native plan sits under the live line.
  const plan = page.locator(
    '[data-slot="turn-live-detail"] [data-slot="turn-plan"]',
  );
  await expect(plan.getByText("Check sources")).toBeVisible();
  await expect(plan.getByRole("img", { name: "To do" })).toBeVisible();
  const cleared = { id: "plan-cleared", revision: 2, items: [] };
  f.setWork({
    plans: [initial, cleared],
    agents: [],
    assignments: [],
    offset: 0,
    historyMore: true,
    agentsMore: false,
  });
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
  ]);
  // Unloaded history does not resurrect the cleared plan.
  await expect(plan).toHaveCount(0);
  f.setWork({
    plans: [cleared, { ...initial, id: "plan-recreated", revision: 3 }],
    agents: [],
    assignments: [],
    offset: 0,
    historyMore: false,
    agentsMore: false,
  });
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
  ]);
  await expect(plan.getByText("Check sources")).toBeVisible();
  await f.emit([{ event: "run.completed", output: "The new plan is ready." }]);
  expect(f.unexpected).toEqual([]);
});

test("keeps older agent discovery reachable when the parent history is short", async ({
  page,
}) => {
  const f = await fixture(page);
  const recent = Array.from({ length: 4 }, (_, i) => ({
    id: `recent-${i}`,
    sessionId: `recent-${i}`,
    goal: `Check recent source ${i + 1}`,
    status: "running" as const,
  }));
  f.setWork({
    plans: [],
    agents: recent,
    assignments: [],
    offset: 0,
    historyMore: false,
    agentsMore: true,
  });
  await send(page);
  await f.emit(
    recent.map((agent) => ({
      event: "subagent.start",
      child_session_id: agent.id,
      goal: agent.goal,
    })),
  );
  await page.getByRole("button", { name: "and 1 more" }).click();
  f.setWork({
    plans: [],
    agents: [
      {
        id: "earlier-child",
        sessionId: "earlier-child",
        goal: "Check archived sources",
        status: "ended",
      },
    ],
    assignments: [],
    offset: 200,
    historyMore: false,
    agentsMore: false,
  });
  const request = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith("/work") && url.searchParams.get("offset") === "200"
    );
  });
  await page.getByRole("button", { name: "Load more agents" }).click();
  await request;
  await expect(
    page
      .getByRole("dialog", { name: "Research agents" })
      .getByRole("button", { name: /Check archived sources/ }),
  ).toBeVisible();
  expect(f.unexpected).toEqual([]);
});

test("shows the latest native plan and inspects a running child without another event subscription", async ({
  page,
}) => {
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
  await page.screenshot({ path: test.info().outputPath("plan.png") });
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
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  expect(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("agent.png") });
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
  await expect(childActivity.getByRole("button").first()).toHaveText(
    "Thinking",
    { timeout: 10_000 },
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
  await page.screenshot({
    path: test.info().outputPath("agent-completed.png"),
  });
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await expect(detail).toHaveCount(0);
  await f.emit([{ event: "run.completed", output: "Sources compared." }]);
  await expect(
    page.getByText("Sources compared.", { exact: true }),
  ).toBeVisible();
  // The finished child stays reachable from the turn's record.
  await page.getByRole("button", { name: /^Worked/ }).click();
  await page
    .locator('[data-slot="activity-list"]')
    .getByRole("button", { name: /Verify source coverage/ })
    .click();
  await expect(
    detail.getByText("Coverage verified.", { exact: true }),
  ).toBeVisible();
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});
