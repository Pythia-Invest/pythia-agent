import { expect, test, type Page } from "@playwright/test";
import type { WorkAgent } from "../src/work/types";
import { fixture } from "./stream-fixture";

// Native agent times are epoch seconds; the page clock starts at this moment.
const NOW = Date.parse("2026-09-30T12:00:00Z") / 1000;
const minute = 60;
const agent = (
  id: string,
  goal: string,
  status: WorkAgent["status"],
  times: Pick<WorkAgent, "startedAt" | "lastActive" | "endedAt">,
): WorkAgent => ({ id, sessionId: id, goal, status, ...times });

/** Loads the chat with saved agents already on record, as after a reload. */
async function openChat(page: Page, agents: WorkAgent[]) {
  await page.clock.install({ time: NOW * 1000 });
  // Agents belong to a chat that has a conversation: an empty one shows only
  // its opening composer.
  const f = await fixture(page, [
    { id: "q", role: "user", content: "Review the filings." },
    { id: "a", role: "assistant", content: "I asked agents to help." },
  ]);
  f.setWork({
    plans: [],
    assignments: [],
    offset: 0,
    historyMore: false,
    agentsMore: false,
    agents,
  });
  const loaded = page.waitForResponse(/\/api\/sessions\/[^/]+\/work\?/);
  await page.reload();
  await loaded;
  return f;
}

const tray = (page: Page) => page.locator('[data-slot="agent-tray"]');

test("lists the chat's background agents and opens one from the keyboard", async ({
  page,
}) => {
  const f = await openChat(page, [
    agent("late", "Compare segment margins", "running", {
      startedAt: NOW - 40,
      lastActive: NOW - 5,
    }),
    agent("early", "Check filing coverage", "running", {
      startedAt: NOW - 125,
      lastActive: NOW - 5,
    }),
    agent("recent", "Verify the auditor's report", "completed", {
      startedAt: NOW - 900,
      endedAt: NOW - 5 * minute,
    }),
  ]);
  f.setAgentPage(
    {
      assignment: "Verify the auditor's report",
      ended: true,
      offset: 0,
      more: false,
      messages: [
        {
          id: "answer",
          role: "assistant",
          parts: [{ type: "text", text: "Auditor report verified." }],
        },
      ],
    },
    "recent",
  );
  const summary = tray(page).getByRole("button", {
    name: /Research agents: 2 running · 1 finished/,
  });
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("list", { name: "Research agents in this chat" }),
  ).toHaveCount(0);

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("list", { name: "Research agents in this chat" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  // Working agents first, oldest start first; the finished one after them.
  await expect(rows.nth(0)).toContainText("Check filing coverage");
  await expect(rows.nth(1)).toContainText("Compare segment margins");
  await expect(rows.nth(2)).toContainText("Verify the auditor's report");

  // The list sits above its toggle, so Shift+Tab reaches its last row.
  await page.keyboard.press("Shift+Tab");
  const finished = rows.nth(2).getByRole("button");
  await expect(finished).toBeFocused();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("region", {
    name: "Research agent conversation",
  });
  await expect(detail.getByText("Auditor report verified.")).toBeVisible();
  // The composer, and the tray above it, give way to the conversation.
  await expect(tray(page)).toBeHidden();

  await detail.getByRole("button", { name: "Back to chat" }).click();
  await expect(detail).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Main conversation" }),
  ).toBeVisible();
  await expect(summary).toBeVisible();
  expect(f.unexpected).toEqual([]);
});

test("shows no tray for agents that finished more than 30 minutes ago", async ({
  page,
}) => {
  const f = await openChat(page, [
    agent("old", "Check filing coverage", "completed", {
      startedAt: NOW - 3_000,
      endedAt: NOW - 31 * minute,
    }),
    agent("older", "Compare segment margins", "failed", {
      startedAt: NOW - 20_000,
      endedAt: NOW - 3 * 60 * minute,
    }),
  ]);
  // The work read has landed (openChat waits for it), so absence is real.
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect(tray(page)).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
});

test("drops a finished agent from the tray as the page clock passes 30 minutes", async ({
  page,
}) => {
  const f = await openChat(page, [
    agent("recent", "Check filing coverage", "completed", {
      startedAt: NOW - 900,
      endedAt: NOW - 5 * minute,
    }),
  ]);
  await expect(
    tray(page).getByRole("button", { name: /1 finished/ }),
  ).toBeVisible();
  await page.clock.runFor(26 * minute * 1000);
  await expect(tray(page)).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
});
