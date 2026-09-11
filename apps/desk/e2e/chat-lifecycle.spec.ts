import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("carries one live reply through navigation and hiding the dock", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) < 900,
    "The persistent side dock belongs to desktop; phone sheet access is covered separately.",
  );
  const f = await fixture(page);
  await send(page);
  await f.emit([{ event: "message.delta", delta: "Beginning the answer." }]);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await expect(
    dock.getByText("Beginning the answer.", { exact: true }),
  ).toBeVisible();
  await dock.getByRole("button", { name: "Hide Pythia" }).click();
  await f.emit([
    { event: "message.delta", delta: " Continuing while hidden." },
  ]);
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  await expect(
    dock.getByText("Beginning the answer. Continuing while hidden.", {
      exact: true,
    }),
  ).toBeVisible();
  await f.emit([{ event: "run.completed", output: "Complete answer." }]);
  await expect(
    dock.getByText("Complete answer.", { exact: true }),
  ).toBeVisible();
  expect(f.streamRequests()).toBe(1);
  expect(f.submissions).toHaveLength(1);
  expect(f.unexpected).toEqual([]);
});

test("loads older messages without moving the visible history anchor", async ({
  page,
}) => {
  const history = Array.from({ length: 101 }, (_, index) => ({
    id: `user-${index}`,
    role: "user",
    content: `Historical question ${index}`,
  }));
  await fixture(page, history);
  const viewport = page.locator('[data-slot="conversation"]');
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event("scroll"));
  });
  const anchor = page.getByText("Historical question 1", { exact: true });
  await expect(anchor).toBeInViewport();
  const before = await anchor.evaluate(
    (node) => node.getBoundingClientRect().top,
  );
  await page.getByRole("button", { name: "Load earlier" }).click();
  await expect(
    page.getByText("Historical question 0", { exact: true }),
  ).toHaveCount(1);
  await expect
    .poll(() => anchor.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(before, 0);
  await expect(page.getByRole("button", { name: "Load earlier" })).toHaveCount(
    0,
  );
});

test("Stop during run creation reaches Hermes once the run is accepted", async ({
  page,
}) => {
  const f = await fixture(page);
  const creating = Promise.withResolvers<void>();
  f.delayCreation(creating.promise);
  try {
    await send(page);
    await expect.poll(() => f.submissions.length).toBe(1);
    await page.getByRole("button", { name: "Stop generating" }).click();
    expect(f.stops).toEqual([]);
  } finally {
    creating.resolve();
  }
  await expect.poll(() => f.stops).toEqual(["synthetic-run"]);
  await expect(page.getByText("Stopped.", { exact: true })).toBeVisible();
  expect(f.unexpected).toEqual([]);
});

test("keeps rejected guidance in the composer", async ({ page }) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([
    { event: "tool.started", tool: "read_file", preview: "example" },
  ]);
  f.rejectSteer();
  const input = page.getByRole("textbox", { name: "Message Pythia" });
  await input.fill("Keep this guidance draft");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("This run no longer accepts guidance.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("Keep this guidance draft");
  await expect(page.getByText("Approval not recorded.")).toHaveCount(0);
  await f.emit([{ event: "run.cancelled" }]);
});

test("an older failure cannot retry a different successful prompt", async ({
  page,
}) => {
  const f = await fixture(page);
  await send(page);
  await f.emit([{ event: "run.failed", error: "First attempt failed" }]);
  const error = page
    .getByRole("alert")
    .filter({ hasText: "First attempt failed" });
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Message Pythia" })
    .fill("Second question");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => f.submissions.length).toBe(2);
  await f.emit([{ event: "run.completed", output: "Second answer" }]);
  await expect(page.getByText("Second answer", { exact: true })).toBeVisible();
  await expect(error.getByRole("button", { name: "Retry" })).toHaveCount(0);
  expect(f.submissions).toEqual([
    "Check the synthetic example.",
    "Second question",
  ]);
});

test("phone settings stays usable while chat opens and closes as a sheet", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) >= 900,
    "Sheet behavior belongs to narrow viewports; desktop dock is covered separately.",
  );
  await fixture(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const theme = page.getByRole("combobox", { name: "Theme" });
  await theme.click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await page.getByRole("button", { name: "Open Pythia", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Pythia chat" });
  await expect(
    sheet.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Hide Pythia" }).click();
  await expect(sheet).toBeHidden();
  await theme.click();
  await page.getByRole("option", { name: "System", exact: true }).click();
});
