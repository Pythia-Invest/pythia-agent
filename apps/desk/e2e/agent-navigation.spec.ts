import { expect, test, type Page } from "@playwright/test";
import type { AgentPage, WorkAgent, WorkPage } from "../src/work/types";
import { fixture, send } from "./stream-fixture";

const work = (agents: WorkAgent[], more = false, offset = 0): WorkPage => ({
  plans: [],
  assignments: [],
  offset,
  historyMore: false,
  agentsMore: more,
  agents,
});
const child = (assignment: string, text: string): AgentPage => ({
  assignment,
  ended: true,
  offset: 0,
  more: false,
  messages: [
    { id: "reply", role: "assistant", parts: [{ type: "text", text }] },
  ],
});
async function filter(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Agent status" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
/** The turn lists its first agents; "and N more" opens the directory. */
async function directory(page: Page) {
  await page.getByRole("button", { name: /^and \d+ more$/ }).click();
  return page.getByRole("dialog", { name: "Research agents" });
}
const detailRegion = (page: Page) =>
  page.getByRole("region", { name: "Research agent conversation" });
async function startAgents(
  f: Awaited<ReturnType<typeof fixture>>,
  agents: WorkAgent[],
) {
  await f.emit(
    agents.map((agent) => ({
      event: "subagent.start",
      child_session_id: agent.id,
      goal: agent.goal,
    })),
  );
}

test("switches agents in place, retains directory navigation and restores a child's reading position", async ({
  page,
}) => {
  const f = await fixture(page);
  const assignment =
    "Verify the dates and provenance of all source documents for the parent.";
  const agents: WorkAgent[] = [
    {
      id: "child-alpha",
      sessionId: "child-alpha",
      title: "Source dates",
      goal: assignment,
      status: "ended",
    },
    {
      id: "child-beta",
      sessionId: "child-beta",
      title: "Source coverage",
      goal: "Compare coverage across the supplied sources.",
      status: "ended",
    },
    {
      id: "child-gamma",
      sessionId: "child-gamma",
      goal: "Check prices",
      status: "running",
    },
    {
      id: "child-delta",
      sessionId: "child-delta",
      goal: "Check filings",
      status: "running",
    },
  ];
  f.setWork(work(agents));
  f.setAgentPage(
    child(
      assignment,
      Array.from({ length: 55 }, (_, i) => `Saved source note ${i + 1}.`).join(
        "\n\n",
      ),
    ),
    "child-alpha",
  );
  f.setAgentPage(
    child(
      "Compare coverage across the supplied sources.",
      "Coverage is complete.",
    ),
    "child-beta",
  );
  await send(page);
  await startAgents(f, agents);
  const panel = await directory(page);
  const search = panel.getByRole("searchbox", { name: "Search agents" });
  await search.fill("source");
  await filter(page, "Finished");
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("button", { name: /Source dates/ }).focus();
  await page.keyboard.press("Enter");
  const detail = detailRegion(page);
  await expect(
    detail.locator('[data-role="user"]').getByText(assignment),
  ).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Back to chat" }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeHidden();
  const chatBounds = await page
    .locator('[data-slot="chat-view"]')
    .boundingBox();
  const detailBounds = await detail.boundingBox();
  expect(detailBounds?.width).toBe(chatBounds?.width);
  const viewport = detail.locator('[data-slot="conversation"]');
  await expect(
    detail.getByText("Saved source note 55.", { exact: true }),
  ).toBeVisible();
  await viewport.evaluate((e) => {
    e.scrollTop = 300;
    e.dispatchEvent(new Event("scroll"));
  });
  await expect(
    detail.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  const saved = await viewport.evaluate((e) => e.scrollTop);
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await (await directory(page))
    .getByRole("button", { name: /Source coverage/ })
    .click();
  await expect(detail.getByText("Coverage is complete.")).toBeVisible();
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await directory(page);
  await expect(search).toHaveValue("source");
  await expect(
    panel.getByRole("combobox", { name: "Agent status" }),
  ).toHaveText("Finished");
  await panel.getByRole("button", { name: /Source dates/ }).click();
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollTop))
    .toBeCloseTo(saved, 0);
  await expect(
    detail.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("agent-light.png"),
    animations: "disabled",
  });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.screenshot({
    path: test.info().outputPath("agent-dark.png"),
    animations: "disabled",
  });
  expect(await detail.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await expect(detail).toHaveCount(0);
  await directory(page);
  await expect(search).toHaveValue("source");
  await page.screenshot({
    path: test.info().outputPath("agent-directory-dark.png"),
    animations: "disabled",
  });
  await panel.getByRole("button", { name: /Source dates/ }).click();
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollTop))
    .toBeCloseTo(saved, 0);
  expect(f.streamRequests()).toBe(1);
  expect(f.unexpected).toEqual([]);
});

test("browses 225 agents with bounded rows, incomplete search disclosure and only selected history", async ({
  page,
}) => {
  const f = await fixture(page);
  const agents: WorkAgent[] = Array.from({ length: 225 }, (_, i) => ({
    id: `child-${i}`,
    sessionId: `child-${i}`,
    title: `Company ${i + 1}`,
    goal: `Verify company ${i + 1} sources`,
    status: "ended",
  }));
  f.setWorkPage(work(agents.slice(0, 200), true));
  f.setWorkPage(work(agents.slice(200), false, 200));
  f.setAgentPage(
    child("Verify company 225 sources", "Last company checked."),
    "child-224",
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith("/work")) requests.push(url.search);
  });
  await send(page);
  // This turn started four of them; the directory pages through all loaded.
  await startAgents(f, agents.slice(0, 4));
  const panel = await directory(page);
  const list = panel.getByRole("list", { name: "Agents", exact: true });
  await expect(list.getByRole("button")).toHaveCount(25);
  await panel.getByRole("button", { name: "Next agents" }).click();
  await expect(list.getByRole("button").first()).toContainText("Company 26");
  await panel
    .getByRole("searchbox", { name: "Search agents" })
    .fill("company 225");
  await expect(panel.getByText("No matching agents.")).toBeVisible();
  await expect(
    panel.getByText(
      "More agents may be available. Search covers loaded agents.",
    ),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Load more agents" }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(
    panel.getByRole("button", { name: "Load more agents" }),
  ).toHaveCount(0);
  expect(requests.filter((q) => q.includes("child="))).toEqual([]);
  const oldReads = requests.filter((q) => q.includes("offset=200")).length;
  // A native update refreshes only the recent window after older pages are loaded.
  const refreshed = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/work") &&
      new URL(r.url()).searchParams.get("offset") === "0",
  );
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
  ]);
  await refreshed;
  expect(requests.filter((q) => q.includes("offset=200"))).toHaveLength(
    oldReads,
  );
  await list.getByRole("button").click();
  await expect(
    detailRegion(page).getByText("Last company checked."),
  ).toBeVisible();
  expect(
    requests
      .filter((q) => q.includes("child="))
      .every((q) => q.includes("child=child-224")),
  ).toBe(true);
  await detailRegion(page)
    .getByRole("button", { name: "Back to chat" })
    .click();
  await directory(page);
  await panel.getByRole("searchbox", { name: "Search agents" }).fill("");
  const initialIds = await list
    .getByRole("button")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-agent-id")),
    );
  f.setWorkPage(work([...agents.slice(0, 200)].reverse(), true));
  const reloaded = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/work") &&
      new URL(r.url()).searchParams.get("offset") === "0",
  );
  await f.emit([
    { event: "tool.started", tool: "todo" },
    { event: "tool.completed", tool: "todo" },
  ]);
  await reloaded;
  await expect(list.getByRole("button").first()).toContainText("Company 1");
  expect(
    await list
      .getByRole("button")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-agent-id")),
      ),
  ).toEqual(initialIds);
  expect(f.unexpected).toEqual([]);
});

test("keeps the parent run, draft and reading position while an agent uses the main chat space", async ({
  page,
}) => {
  const history = Array.from({ length: 30 }, (_, i) => [
    {
      id: `question-${i}`,
      role: "user",
      content: `Earlier question ${i + 1}.`,
    },
    {
      id: `saved-${i}`,
      role: "assistant",
      content: `Earlier answer ${i + 1}.`,
    },
  ]).flat();
  const f = await fixture(page, history);
  const agent: WorkAgent = {
    id: "child",
    sessionId: "child",
    title: "Source check",
    goal: "Check the source",
    status: "ended",
  };
  f.setWork(work([agent]));
  f.setAgentPage(child("Check the source", "The source is confirmed."));
  await send(page);
  await startAgents(f, [agent]);
  await page
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Keep this draft while I read.");
  const viewport = page.locator('[data-slot="conversation"]');
  await viewport.evaluate((e) => {
    e.scrollTop = 250;
    e.dispatchEvent(new Event("scroll"));
  });
  const saved = await viewport.evaluate((e) => e.scrollTop);
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  // Activate the agent without scrolling the parent transcript under it.
  await page
    .locator('[data-slot="turn-live-detail"]')
    .getByRole("button", { name: /Source check/ })
    .evaluate((button: HTMLElement) => button.click());
  await expect(page.getByText("The source is confirmed.")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeHidden();
  await expect(page.locator('[data-slot="conversation"]')).toHaveCount(1);
  await f.emit([
    {
      event: "run.completed",
      output: "Parent finished while you were reading.",
    },
  ]);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("pythia-desk:unread-chats") ?? "[]"),
      ),
    )
    .toContain("synthetic-chat");
  await page.getByRole("button", { name: "Back to chat" }).click();
  await expect(
    page.getByText("Parent finished while you were reading."),
  ).toBeAttached();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toHaveValue("Keep this draft while I read.");
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollTop))
    .toBeCloseTo(saved, 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("pythia-desk:unread-chats") ?? "[]"),
      ),
    )
    .toContain("synthetic-chat");
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect(
    page.getByText("Parent finished while you were reading."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("pythia-desk:unread-chats") ?? "[]"),
      ),
    )
    .not.toContain("synthetic-chat");
  expect(f.streamRequests()).toBe(1);
  expect(f.submissions).toHaveLength(1);
  expect(f.unexpected).toEqual([]);
});
