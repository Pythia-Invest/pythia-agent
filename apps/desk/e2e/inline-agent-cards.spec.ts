import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("a delegated agent opens its saved chat and stays reachable after completion", async ({
  page,
}, testInfo) => {
  const f = await fixture(page);
  f.setAgentPage({
    assignment: "Verify source coverage",
    ended: true,
    offset: 0,
    more: false,
    messages: [
      {
        id: "child-answer",
        role: "assistant",
        parts: [{ type: "text", text: "Sources verified." }],
      },
    ],
  });
  await send(page);
  await f.emit([
    {
      event: "subagent.start",
      child_session_id: "child",
      goal: "Verify source coverage",
      model: "research-model",
    },
  ]);
  // While Pythia works, its agents sit under the live line.
  const live = page.locator('[data-slot="turn-live-detail"]');
  await expect(live.getByRole("img", { name: "Working" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("inline-agents.png") });
  await live.getByRole("button", { name: /Verify source coverage/ }).click();
  const detail = page.getByRole("region", {
    name: "Research agent conversation",
  });
  await expect(detail.getByText("Sources verified.")).toBeVisible();
  await detail.getByRole("button", { name: "Back to chat" }).click();
  await f.emit([
    {
      event: "subagent.complete",
      child_session_id: "child",
      status: "completed",
    },
    { event: "run.completed", output: "Research finished." },
  ]);
  // Once settled, the agent is part of the turn's record.
  await expect(live).toHaveCount(0);
  await page.getByRole("button", { name: /^Worked/ }).click();
  const record = page.locator('[data-slot="activity-list"]');
  await expect(
    record.getByRole("button", { name: /Verify source coverage/ }),
  ).toBeVisible();
  await expect(record.getByRole("img", { name: "Working" })).toHaveCount(0);
  expect(f.unexpected).toEqual([]);
});
