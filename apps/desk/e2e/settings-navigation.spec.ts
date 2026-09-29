import { expect, type Page, test } from "@playwright/test";
import { checkedToday, isPhone, settingsFixture } from "./settings-fixture";

function settings(page: Page) {
  return page.getByRole("dialog", { name: "Settings" });
}

/** On a phone a chosen page fills the screen; its back button returns to
 * the list and search. On desktop both are always on screen. */
async function toList(page: Page) {
  if (isPhone(page))
    await settings(page)
      .getByRole("button", { name: "Settings", exact: true })
      .click();
}

test("marks only the sections that need attention", async ({ page }) => {
  await checkedToday(page);
  const state = await settingsFixture(page);
  // A failed update needs the reader; a connected provider does not.
  await page.route("**/api/update-status**", (route) =>
    route.fulfill({
      json: {
        status: "ready",
        channel: "preview",
        current_version: "main",
        current_revision: "a".repeat(40),
        apply_supported: true,
        update_available: false,
        updater: "failed",
      },
    }),
  );
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/\?settings=$/);
  const navigation = settings(page).getByRole("navigation", {
    name: "Settings sections",
  });
  await expect(
    navigation.getByRole("img", { name: "Needs attention" }),
  ).toHaveCount(1);
  await expect(
    navigation
      .getByRole("link", { name: /^About/ })
      .getByRole("img", { name: "Needs attention" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.releaseStarts()).toBe(0);
  expect(state.unexpected).toEqual([]);
});

test("search finds pages and single settings, and marks the one chosen", async ({
  page,
}) => {
  await checkedToday(page);
  await settingsFixture(page);
  await page.goto("/?settings=model/main");
  await toList(page);
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("approval mode");
  const results = page.getByRole("listbox", {
    name: "Settings search results",
  });
  await expect(results.getByRole("option")).toHaveCount(1);
  await expect(results.getByRole("option").first()).toContainText(
    "Safety › Approvals",
  );
  await search.press("Enter");
  await expect(page).toHaveURL(/settings=safety\/approvals/);
  await expect(page.locator("#setting-approvals\\.mode")).toHaveAttribute(
    "data-highlight",
    "true",
  );
  // Escape clears a search before it closes anything.
  await toList(page);
  await search.fill("theme");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(settings(page)).toBeVisible();
});

test("settings fills the window with a section tree, breadcrumb and history", async ({
  page,
}) => {
  await checkedToday(page);
  await settingsFixture(page);
  await page.goto("/");
  const dialog = settings(page);
  if (isPhone(page))
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.height).toBe(viewport?.height);
  const navigation = dialog.getByRole("navigation", {
    name: "Settings sections",
  });
  if (isPhone(page)) {
    // A phone starts at the list; a page then fills the screen.
    await navigation.getByRole("link", { name: "Approvals" }).click();
    await expect(page).toHaveURL(/settings=safety\/approvals/);
    await toList(page);
    await expect(navigation).toBeVisible();
  } else {
    // The open section shows its pages; another section opens its first.
    await expect(
      navigation.getByRole("link", { name: "Main model" }),
    ).toHaveAttribute("aria-current", "page");
    await navigation.getByRole("link", { name: "Safety" }).click();
    await expect(page).toHaveURL(/settings=safety\/approvals/);
    await navigation.getByRole("link", { name: "Privacy & network" }).click();
    await expect(
      dialog.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Safety›Privacy & network");
  }
  // Back closes Settings, where it opened.
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});

test("capabilities live on their own page, and old settings links follow", async ({
  page,
}) => {
  await checkedToday(page);
  const state = await settingsFixture(page);
  await page.goto("/settings?section=skills");
  await expect(page).toHaveURL(/\/capabilities\?tab=skills$/);
  const skills = page.getByRole("list", { name: "Skills" });
  await expect(skills.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "On", exact: true }).click();
  await expect(skills.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("tab", { name: /Plugins/ }).click();
  await expect(page).toHaveURL(/tab=plugins/);
  await expect(
    page.getByRole("switch", { name: "pythia", exact: true }),
  ).toBeDisabled();
  await page.getByRole("switch", { name: "synthetic-plugin" }).click();
  await expect
    .poll(() => state.writes.map((write) => write.path))
    .toContain("/api/hermes/plugins/synthetic-plugin");
  expect(state.writes.at(-1)?.body).toEqual({ enabled: true });
});
