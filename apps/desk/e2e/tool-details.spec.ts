import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("inspects live tool details without requesting extra history", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "reports/example.md" },
  ]);
  const toggle = page
    .locator('[data-slot="turn-activity"]')
    .getByRole("button")
    .first();
  await expect(toggle).toHaveText("Reading example.md");
  const historyReads: string[] = [];
  page.on("request", (request) => {
    if (
      /^\/api\/sessions\/[^/]+\/messages$/.test(new URL(request.url()).pathname)
    )
      historyReads.push(request.url());
  });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const row = page.locator('[data-slot="activity-row"]');
  await expect(row).toHaveAttribute("data-state", "running");
  await row.getByRole("button").click();
  await expect(row.getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    row.getByText("reports/example.md", { exact: true }),
  ).toBeVisible();
  await f.emit([{ event: "tool.completed", tool: "read_file", duration: 1 }]);
  await expect(row).toHaveAttribute("data-state", "completed");
  await expect(row.getByRole("button")).toHaveText("Read example.md");
  await expect(
    row.getByText("reports/example.md", { exact: true }),
  ).toBeVisible();
  // The details come from the stream; inspecting them reads no history.
  expect(historyReads).toEqual([]);
  await f.emit([{ event: "message.delta", delta: "A synthetic answer." }]);
  // The answer does not close a record the reader opened.
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await f.emit([{ event: "run.completed", output: "A synthetic answer." }]);
  expect(f.unexpected).toEqual([]);
});

test("shows stored code and output on demand", async ({ page }) => {
  const f = await fixture(page, [
    {
      id: "request",
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "run-1",
          function: {
            name: "terminal",
            arguments: '{"command":"python3 report.py"}',
          },
        },
      ],
    },
    {
      id: "result",
      role: "tool",
      tool_call_id: "run-1",
      content: '{"output": "Synthetic report contents.", "exit_code": 0}',
    },
    { id: "answer", role: "assistant", content: "The report is ready." },
  ]);
  await page.getByRole("button", { name: /^Worked/ }).click();
  const row = page.locator('[data-slot="activity-row"]');
  await row.getByRole("button", { name: "Ran a Python script" }).click();
  await expect(
    row.getByText("python3 report.py", { exact: true }),
  ).toBeVisible();
  await expect(row.locator('[data-slot="activity-output"]')).toHaveText(
    "Synthetic report contents.",
  );
  expect(f.unexpected).toEqual([]);
});
