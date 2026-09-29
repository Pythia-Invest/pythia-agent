import { expect, test } from "@playwright/test";
import { fixture, send } from "./stream-fixture";

test("search selects exact native variants and keeps the current variant visible", async ({
  page,
}) => {
  const f = await fixture(page);
  const trigger = page.getByRole("combobox", { name: "Model", exact: true });
  for (const id of ["research-model-fast", "research-model-20260901"]) {
    await trigger.click();
    await page.getByRole("combobox", { name: "Search models" }).fill(id);
    const option = page.getByRole("option");
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(id);
    await option.click();
    await expect(trigger).toContainText(id);
    await trigger.click();
    await expect(page.getByRole("option", { selected: true })).toContainText(
      id,
    );
    await page.keyboard.press("Escape");
  }
  await send(page);
  await expect.poll(() => f.selections.length).toBe(1);
  expect(f.selections[0]).toMatchObject({ model: "research-model-20260901" });
  await f.emit([{ event: "run.completed", output: "Done" }]);
  expect(f.unexpected).toEqual([]);
});

test("mobile navigation contains keyboard focus and returns it on Escape", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) >= 900,
    "Mobile navigation drawer",
  );
  await fixture(page);
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await expect(
    page.getByRole("link", { name: "Markets", exact: true }),
  ).toHaveCount(0);
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Navigation", exact: true });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      dialog.evaluate((node) => node.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // The scrim sits behind the drawer; tapping the uncovered strip closes it.
  await trigger.click();
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize() ?? { width: 412, height: 915 };
  await page.mouse.click(viewport.width - 24, viewport.height / 2);
  await expect(dialog).toHaveCount(0);
});

test("dock tabs activate with arrows and label the displayed panel", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "Desktop dock tab strip");
  await fixture(page);
  await page.route(/\/api\/sessions(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        data: [
          { id: "synthetic-chat", title: "First synthetic chat" },
          { id: "second-chat", title: "Second synthetic chat" },
        ],
      },
    }),
  );
  await page.reload();
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await dock.getByRole("button", { name: "Chat history" }).click();
  const history = page.getByRole("dialog");
  await history
    .getByRole("button", { name: "Second synthetic chat", exact: true })
    .click();
  const first = dock.getByRole("tab", {
    name: "First synthetic chat",
    exact: true,
  });
  const second = dock.getByRole("tab", {
    name: "Second synthetic chat",
    exact: true,
  });
  await expect(second).toHaveAttribute("aria-selected", "true");
  // A chat that already has a tab says so, and picking it selects that tab
  // instead of adding one, without leaving the page.
  const tabs = dock.getByRole("tab");
  const count = await tabs.count();
  await dock.getByRole("button", { name: "Chat history" }).click();
  await expect(history.getByText("Open", { exact: true })).toHaveCount(2);
  await history
    .getByRole("button", { name: "First synthetic chat", exact: true })
    .click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(tabs).toHaveCount(count);
  await expect(page).toHaveURL(/\/markets$/);
  await second.focus();
  await second.press("ArrowLeft");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(second).toHaveAttribute("tabindex", "-1");
  const panel = dock.getByRole("tabpanel");
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute(
    "aria-labelledby",
    (await first.getAttribute("id")) ?? "",
  );
  await first.press("ArrowRight");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await second.press("Delete");
  await expect(second).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-selected", "true");
});

test("an open chat missing from the bounded session list still renders in the dock", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "Desktop dock");
  await fixture(page, [
    { id: "u", role: "user", content: "Earlier question" },
    { id: "a", role: "assistant", content: "Earlier saved answer" },
  ]);
  await page.route(/\/api\/sessions(?:\?|$)/, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.reload();
  await expect(
    page.getByText("Earlier saved answer", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  const dock = page.getByRole("complementary", { name: "Pythia", exact: true });
  await expect(
    dock.getByText("Earlier saved answer", { exact: true }),
  ).toBeVisible();
  const tab = dock.getByRole("tab", { selected: true });
  await expect(tab).toHaveCount(1);
  await expect(dock.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    (await tab.getAttribute("id")) ?? "",
  );
});
