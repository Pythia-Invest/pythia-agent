import { expect, test } from "@playwright/test";
import type { HermesMessage } from "../src/server/types";
import type { WorkPage } from "../src/work/types";
import { fixture, send } from "./stream-fixture";

// Hermes answers a finished background delegation with a turn it starts itself
// (gateway/wake.py), outside the run Desk streamed. Shapes follow the pinned
// history rows and the async delegation notice.
const asked: HermesMessage[] = [
  { id: "u", role: "user", content: "Check the synthetic example." },
  {
    id: "delegate",
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call-delegate",
        function: {
          name: "delegate_task",
          arguments: '{"goal":"Verify source coverage"}',
        },
      },
    ],
  },
  {
    id: "delegate-result",
    role: "tool",
    tool_call_id: "call-delegate",
    content: '{"status": "dispatched", "subagent_ids": ["sa-1"]}',
  },
  {
    id: "handoff",
    role: "assistant",
    content: "A research agent is checking the sources.",
  },
];
const work = (status: "running" | "ended", endedAt?: number): WorkPage => ({
  plans: [],
  assignments: [],
  offset: 0,
  historyMore: false,
  agentsMore: false,
  agents: [
    {
      id: "child",
      sessionId: "child",
      goal: "Verify source coverage",
      status,
      ...(endedAt ? { endedAt } : {}),
    },
  ],
});

test("shows Hermes's own reply to finished background agents without a reload", async ({
  page,
}) => {
  const f = await fixture(page);
  f.setWork(work("running"));
  await send(page);
  f.setHistory(asked);
  await f.emit([
    {
      event: "subagent.start",
      child_session_id: "child",
      goal: "Verify source coverage",
    },
    {
      event: "run.completed",
      output: "A research agent is checking the sources.",
    },
  ]);
  await expect(
    page.getByText("A research agent is checking the sources."),
  ).toBeVisible();
  // The agent keeps working after the run: the turn says so, not "Worked".
  await expect(page.locator('[data-slot="turn-status"]').last()).toHaveText(
    "A research agent is working",
  );

  // The agent ends; Hermes has not saved its reply yet.
  f.setWork(work("ended", Date.now() / 1000));
  const waiting = page.locator(
    '[data-slot="turn-activity"][data-state="live"]',
  );
  await expect(waiting).toBeVisible({ timeout: 10_000 });

  // Hermes's wake turn is saved: the notice and the answer appear in place.
  f.setHistory([
    ...asked,
    {
      id: "notice",
      role: "user",
      content: "[ASYNC DELEGATION COMPLETE — deleg-1]\nStatus: completed",
    },
    {
      id: "answer",
      role: "assistant",
      content: "The sources agree: revenue 100, operating profit 20.",
    },
  ]);
  await expect(
    page.getByText("The sources agree: revenue 100, operating profit 20."),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Research agents finished")).toBeVisible();
  await expect(waiting).toHaveCount(0);
  expect(f.submissions).toEqual(["Check the synthetic example."]);
  expect(f.unexpected).toEqual([]);
});
