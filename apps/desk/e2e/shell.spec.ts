import { expect, type Page, test } from "@playwright/test";

/**
 * Shell smoke: the sidebar, theme, routing, and the narrow-viewport drawer.
 * Chats come from whatever the running Hermes profile holds; tests that need a
 * chat skip with a reason when the profile is empty rather than creating one.
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

async function openNavigation(page: Page) {
  if (!isPhone(page)) return;
  await page.getByRole("button", { name: "Open navigation" }).click();
}

/** Chat links once the session list has finished loading. */
async function chatLinks(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Chats" });
  await expect(page.getByText("Loading chats…")).toHaveCount(0);
  return navigation.getByRole("link");
}

test("renders the wordmark, New chat, and both chat groups", async ({
  page,
}) => {
  await page.goto("/");
  await openNavigation(page);
  const navigation = page.getByRole("complementary", {
    name: "Desk navigation",
  });
  await expect(navigation.getByText("Pythia", { exact: true })).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "New chat" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("heading", { name: "Pinned" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("heading", { name: "Recents" }),
  ).toBeVisible();
  await expect(navigation.getByText("Loading chats…")).toHaveCount(0);
});

test("switches theme through the footer control and persists it", async ({
  page,
}) => {
  await page.goto("/");
  await openNavigation(page);
  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  const target = before === "dark" ? "light" : "dark";
  await page.getByRole("button", { name: `Switch to ${target} theme` }).click();
  await expect(html).toHaveAttribute("data-theme", target);
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", target);
});

test("opens a chat at its own route and marks it current", async ({ page }) => {
  await page.goto("/");
  await openNavigation(page);
  const links = await chatLinks(page);
  test.skip(
    (await links.count()) === 0,
    "This Hermes profile has no chats; the Desk owner seeds one when needed.",
  );
  const first = links.first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await openNavigation(page);
  await expect(
    page
      .getByRole("navigation", { name: "Chats" })
      .locator('a[aria-current="page"]'),
  ).toHaveCount(1);
});

test("New chat returns to the root route", async ({ page }) => {
  await page.goto("/");
  await openNavigation(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chats to navigate away from.");
  await links.first().click();
  await expect(page).toHaveURL(/\/c\//);
  await openNavigation(page);
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("keyboard reaches New chat and the pin control of a focused chat", async ({
  page,
}) => {
  test.skip(
    isPhone(page),
    "Keyboard traversal is checked on the desktop project.",
  );
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "New chat" })).toBeFocused();
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chats to focus.");
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /^(Pin|Unpin) / }).first(),
  ).toBeFocused();
});

test("the drawer opens and closes on narrow viewports", async ({ page }) => {
  test.skip(!isPhone(page), "Drawer behavior belongs to the phone project.");
  await page.goto("/");
  const navigation = page.getByRole("complementary", {
    name: "Desk navigation",
  });
  await expect(navigation).not.toBeInViewport();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(navigation).toBeInViewport();
  // The scrim sits behind the drawer; tap the uncovered strip beside it.
  const viewport = page.viewportSize() ?? { width: 412, height: 915 };
  await page
    .getByRole("button", { name: "Close navigation" })
    .click({ position: { x: viewport.width - 24, y: viewport.height / 2 } });
  await expect(navigation).not.toBeInViewport();
});
