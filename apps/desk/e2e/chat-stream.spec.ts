import { expect, test } from "@playwright/test";

import { fixture, send } from "./stream-fixture";

test("keeps prose stable and updates one compact activity line", async ({
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
  await send(page);
  await f.emit([
    {
      event: "reasoning.available",
      text: "Gathering the example sources",
    },
  ]);
  const live = page
    .locator('[data-slot="process-block"][data-state="live"]')
    .getByRole("status");
  await expect(
    live.getByText("Gathering the example sources", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="process-block"]')).toHaveCount(1);
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
  await expect
    .poll(() => f.steers)
    .toEqual(["Use the annual report as the primary source."]);
  await f.emit([{ event: "run.steered" }]);
  await expect(
    page.getByText(/Direction added · Use the annual report/u),
  ).toBeVisible();
  await f.emit([
    {
      event: "reasoning.available",
      text: "Reviewing the example report",
    },
  ]);
  await expect(
    live.getByText("Reviewing the example report", { exact: true }),
  ).toBeVisible();
  await expect(
    live.getByText("Gathering the example sources", { exact: true }),
  ).toHaveCount(0);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "example-report.md" },
  ]);
  await expect(
    live.getByText("Exploring example-report.md", { exact: true }),
  ).toBeVisible();
  const activity = live;
  await expect(activity).toBeVisible();
  await expect(
    activity.getByText("Exploring example-report.md", { exact: true }),
  ).toBeVisible();
  await expect(activity.getByText(/\d+s/u)).toBeVisible();
  await expect(page.locator('[data-slot="process-block"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="process-body"]')).toHaveCount(0);
  await f.emit([
    { event: "tool.completed", tool: "read_file", duration: 1.4 },
    { event: "message.delta", delta: "An incomplete draft" },
  ]);
  await expect(
    page.locator('[data-role="assistant"]').filter({
      hasText: "An incomplete draft",
    }),
  ).toBeVisible();
  const collapsed = page.getByRole("button", {
    name: /\d+ steps?/,
    exact: true,
  });
  await expect(collapsed).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.locator('[data-slot="process-block"][data-state="live"]'),
  ).toHaveCount(0);
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
  const group = page.getByRole("button", { name: /\d+ steps?/, exact: true });
  if ((await group.getAttribute("aria-expanded")) === "false")
    await group.click();
  await expect(
    page.getByText("Explored example-report.md", { exact: true }),
  ).toBeVisible();
  await expect(commentary).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  expect(f.submissions).toEqual(["Check the synthetic example."]);
  expect(f.selections).toEqual([
    { provider: "synthetic", model: "research-model" },
  ]);
  expect(f.unexpected).toEqual([]);
});

test("leaves a streamed answer in place when the reader scrolls up", async ({
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
  await viewport.evaluate((element) => {
    element.scrollTop = Math.max(
      0,
      element.scrollHeight - element.clientHeight - 240,
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
    page.getByText("Exploring filing", { exact: true }),
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
  const activity = page
    .locator('[data-slot="process-block"][data-state="live"]')
    .getByRole("status");
  await expect(
    activity.getByText("Exploring example.md", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="process-block"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="process-body"]')).toHaveCount(0);
  await f.emit([{ event: "run.cancelled" }]);
  await expect(page.getByText("Stopped.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: /steps · some results unavailable/,
      exact: true,
    })
    .click();
  await expect(
    page.locator('[data-slot="process-tool"][data-state="unconfirmed"]'),
  ).toHaveCount(2);
  await expect(
    page.locator('[data-slot="process-tool"][data-state="completed"]'),
  ).toHaveCount(0);
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
