import { expect, test } from "@playwright/test";

import { fixture, send } from "./stream-fixture";

test("model search reaches the whole catalog and visible models can be edited", async ({
  page,
}) => {
  const f = await fixture(page);
  const modelTrigger = page.getByRole("combobox", {
    name: "Model",
    exact: true,
  });
  await expect(modelTrigger).toHaveAttribute("type", "button");
  await modelTrigger.click();
  const modelSearch = page.getByRole("combobox", { name: "Search models" });
  await expect(modelSearch).toBeFocused();
  const modelList = page.getByRole("listbox");
  await expect(
    modelList.getByRole("option", { name: /research-model/u }),
  ).toBeVisible();
  await expect(
    modelList.getByRole("option", { name: /compact-model-24/u }),
  ).toHaveCount(0);
  await modelSearch.fill("compact-model-24");
  await expect(
    modelList.getByRole("option", { name: /compact-model-24/u }),
  ).toBeVisible();
  await expect(
    modelList.getByRole("option", { name: /research-model/u }),
  ).toHaveCount(0);
  await modelSearch.fill("compact");
  await modelList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => modelList.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await modelTrigger.click();
  await expect(modelSearch).toHaveValue("");
  await expect(
    modelList.getByRole("option", { name: /research-model/u }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit visible models" }).click();
  const manager = page.getByRole("dialog", { name: "Edit visible models" });
  await expect(manager).toBeVisible();
  await manager
    .getByRole("textbox", { name: "Search providers and models" })
    .fill("compact-model-24");
  const compactModelSwitch = manager.getByRole("switch", {
    name: "compact-model-24",
  });
  await expect(compactModelSwitch).not.toBeChecked();
  await compactModelSwitch.click();
  await expect(compactModelSwitch).toBeChecked();
  await manager.getByRole("button", { name: "Close model manager" }).click();
  await modelTrigger.click();
  await expect(modelSearch).toBeFocused();
  await expect(modelSearch).toHaveValue("");
  await expect(
    modelList.getByRole("option", { name: /compact-model-24/u }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit visible models" }).click();
  await manager
    .getByRole("textbox", { name: "Search providers and models" })
    .fill("compact-model-24");
  await manager.getByRole("switch", { name: "compact-model-24" }).click();
  await manager.getByRole("button", { name: "Close model manager" }).click();
  await modelTrigger.click();
  await modelSearch.fill("compact-model-24");
  await expect(
    modelList.getByRole("option", { name: /compact-model-24/u }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(f.unexpected).toEqual([]);
});

test("keeps activity inspectable while streamed prose uses the answer area", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    {
      event: "reasoning.available",
      text: "Gathering the example sources",
    },
  ]);
  // One quiet line while Pythia works; its record opens on request. Guidance
  // closes the segment before it, so the live line is always the last one.
  const activity = page.locator('[data-slot="turn-activity"]').last();
  const toggle = activity.getByRole("button").first();
  await expect(activity).toHaveAttribute("data-state", "live");
  await expect(toggle).toHaveText("Thinking");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Use the annual report as the primary source.");
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Send message" }).click();
  // Guidance reads as the user's own message at once, before Hermes reports it.
  const steer = page
    .locator('[data-role="user"]')
    .filter({ hasText: "Use the annual report as the primary source." });
  await expect(steer).toBeVisible();
  await expect
    .poll(() => f.steers)
    .toEqual(["Use the annual report as the primary source."]);
  await f.emit([{ event: "run.steered" }]);
  await expect(steer).toHaveCount(1);
  await f.emit([
    {
      event: "reasoning.available",
      text: "Reviewing the example report",
    },
  ]);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "example-report.md" },
  ]);
  await expect(toggle).toHaveText("Reading example-report.md");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const record = activity.locator('[data-slot="activity-list"]');
  await expect(
    record.getByText("Reviewing the example report", { exact: true }),
  ).toBeVisible();
  await expect(
    record.locator('[data-slot="activity-row"][data-state="running"]'),
  ).toHaveText("Reading example-report.md");
  await toggle.click();
  // The work before the guidance stays with its own segment.
  const earlier = page.locator('[data-slot="turn-activity"]').first();
  await earlier.getByRole("button").first().click();
  await expect(
    earlier.getByText("Gathering the example sources", { exact: true }),
  ).toBeVisible();
  await earlier.getByRole("button").first().click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await f.emit([
    { event: "tool.completed", tool: "read_file", duration: 1.4 },
    { event: "message.delta", delta: "An incomplete draft" },
  ]);
  await expect(
    page.locator('[data-role="assistant"]').filter({
      hasText: "An incomplete draft",
    }),
  ).toBeVisible();
  const commentary = page.getByText("I will compare the two example sources.", {
    exact: true,
  });
  f.setHistory([
    { id: "u", role: "user", content: "Check the synthetic example." },
    {
      id: "a",
      role: "assistant",
      content: "I will compare the two example sources.",
      tool_calls: [
        {
          id: "native-call",
          function: {
            name: "read_file",
            arguments: '{"path":"example-report.md"}',
          },
        },
      ],
    },
    {
      id: "t",
      role: "tool",
      tool_call_id: "native-call",
      content: "Synthetic source: revenue 100, operating profit 20.",
    },
    {
      id: "final",
      role: "assistant",
      content:
        "The example has a **20% operating margin**. See the [synthetic report](https://example.com/report). This is synthetic evidence, not an investment recommendation.",
    },
  ]);
  await f.emit([
    {
      event: "run.completed",
      output:
        "The example has a **20% operating margin**. See the [synthetic report](https://example.com/report). This is synthetic evidence, not an investment recommendation.",
      usage: { input_tokens: 800, output_tokens: 200, total_tokens: 1000 },
    },
  ]);
  await expect(
    page.getByText("An incomplete draft", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("20% operating margin", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy answer" })).toBeVisible();
  await page.getByRole("button", { name: "1 source" }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: /synthetic report/u }),
  ).toHaveAttribute("href", "https://example.com/report");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveText(/^Worked for/u);
  if ((await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
  await expect(
    page.getByText("Read example-report.md", { exact: true }),
  ).toBeVisible();
  await expect(commentary).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(f.submissions).toEqual(["Check the synthetic example."]);
  expect(f.selections).toEqual([
    { provider: "synthetic", model: "research-model" },
  ]);
  expect(f.unexpected).toEqual([]);
});

test("keeps latest hidden after no-op scroll gestures in a short chat", async ({
  page,
}) => {
  const f = await fixture(page, [
    { id: "short-answer", role: "assistant", content: "A short answer." },
  ]);
  const viewport = page.locator('[data-slot="conversation"]');
  await expect(
    page.getByText("A short answer.", { exact: true }),
  ).toBeVisible();
  expect(
    await viewport.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    ),
  ).toBe(0);
  await viewport.dispatchEvent("wheel", { deltaY: -120 });
  await viewport.dispatchEvent("touchstart", {
    touches: [{ identifier: 1, clientY: 100 }],
  });
  await viewport.dispatchEvent("touchmove", {
    touches: [{ identifier: 1, clientY: 180 }],
  });
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeHidden();
  // The no-op gesture must also leave streaming follow enabled when text grows.
  await send(page);
  await f.emit([
    {
      event: "message.delta",
      delta: Array.from({ length: 80 }, (_, i) => `Research line ${i}.`).join(
        "\n\n",
      ),
    },
  ]);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(200);
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeHidden();
  await f.emit([{ event: "run.cancelled" }]);
  expect(f.unexpected).toEqual([]);
});

test("leaves a streamed answer in place after a gentle upward gesture", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  const firstPage = Array.from(
    { length: 80 },
    (_, index) => `Research line ${index + 1}.`,
  ).join("\n\n");
  await f.emit([{ event: "message.delta", delta: firstPage }]);

  const viewport = page.locator('[data-slot="conversation"]');
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(200);
  await viewport.dispatchEvent("wheel", { deltaY: -8 });
  await viewport.evaluate((element) => {
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight - 8,
    );
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.getByRole("button", { name: "Jump to latest" }),
  ).toBeVisible();
  const before = await viewport.evaluate((element) => element.scrollTop);

  await f.emit([
    {
      event: "message.delta",
      delta: "\n\nA newly streamed line must not move the reader.",
    },
  ]);
  await expect(
    page.getByText("A newly streamed line must not move the reader."),
  ).toBeAttached();
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThanOrEqual(before + 1);

  await page.getByRole("button", { name: "Jump to latest" }).click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await f.emit([{ event: "message.delta", delta: "\n\nFollowing again." }]);
  await expect(page.getByText("Following again.")).toBeVisible();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(2);
  await f.emit([{ event: "run.cancelled" }]);
  expect(f.unexpected).toEqual([]);
});

test("shows the Hermes error without replacing it with Desk guidance", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  const backendError =
    "HTTP 400: Error from provider (Console): Upstream request failed: Model is unavailable.";
  await f.emit([
    {
      event: "run.failed",
      error: backendError,
    },
  ]);

  const alert = page.getByRole("alert").filter({
    hasText: "Model is unavailable.",
  });
  await expect(alert).toContainText("Synthetic · Research Model · HTTP 400");
  await expect(
    page.getByText("Pythia could not finish this reply."),
  ).toHaveCount(0);
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => f.selections.length).toBe(2);
  expect(f.selections[1]).toEqual({
    provider: "synthetic",
    model: "research-model",
  });
  expect(f.unexpected).toEqual([]);
});

test("recovers by status when reload loses the native event queue", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "web_search", preview: "filing" },
  ]);
  await expect(
    page.locator('[data-slot="turn-status"]').getByText("Searching the web", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect.poll(f.streamRequests).toBe(2);
  f.setStatus({
    run_id: "synthetic-run",
    status: "completed",
    output: "Recovered after reload.",
  });
  await expect(
    page.getByText("Recovered after reload.", { exact: true }),
  ).toBeVisible();
  expect(f.unexpected).toEqual([]);
});

test("shows the exact approval command and leaves interrupted parallel tools unconfirmed", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    {
      event: "approval.request",
      request_id: "approval",
      description: "Delete the generated example file",
      command: "rm /tmp/synthetic-generated-example.txt",
      choices: ["once", "deny"],
    },
  ]);
  await expect(page.getByLabel("Command requiring approval")).toHaveText(
    "rm /tmp/synthetic-generated-example.txt",
  );
  await expect(
    page.getByRole("button", { name: "Always allow", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  await expect.poll(() => f.approvals.length).toBe(1);
  expect(f.approvals[0]).toEqual({ choice: "once", request_id: "approval" });
  await f.emit([
    { event: "approval.responded", request_id: "approval", choice: "once" },
    {
      event: "tool.started",
      tool: "terminal",
      preview: "remove generated file",
    },
    { event: "tool.started", tool: "read_file", preview: "example.md" },
  ]);
  const activity = page.locator('[data-slot="turn-activity"]');
  const toggle = activity.getByRole("button").first();
  await expect(activity).toHaveAttribute("data-state", "live");
  await expect(toggle).toHaveText("Reading example.md");
  await expect(activity).toHaveCount(1);
  await f.emit([{ event: "run.cancelled" }]);
  await expect(page.getByText("Stopped.", { exact: true })).toBeVisible();
  await expect(activity).toHaveAttribute("data-state", "settled");
  await toggle.click();
  const record = activity.locator('[data-slot="activity-list"]');
  await expect(
    record.getByText("You allowed a command once", { exact: true }),
  ).toBeVisible();
  await expect(
    record.locator('[data-slot="activity-row"][data-state="unconfirmed"]'),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Allow once", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(f.unexpected).toEqual([]);
});
