import { expect, type Page, test } from "@playwright/test";
import { openDesk } from "./open-desk";

/**
 * Shell smoke: the navigation rail, the chat list, theme, routing, and the
 * narrow-viewport drawer. Chats come from whatever the running Hermes profile
 * holds; tests that need a chat skip with a reason when the profile is empty
 * rather than creating one.
 */

/** Matches the shell: below 900px the rail and the list share one drawer. */
const isNarrow = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function openNavigation(page: Page) {
  if (!isNarrow(page)) return;
  await page.getByRole("button", { name: "Open navigation" }).click();
}

/** Chat links once the session list has finished loading. */
async function chatLinks(page: Page) {
  const navigation = page.getByRole("navigation", { name: "Chats" });
  await expect(page.getByText("Loading chats…")).toHaveCount(0);
  return navigation.getByRole("link");
}

test("separates the navigation rail from the chat list", async ({ page }) => {
  await openDesk(page);
  await expect(
    page.getByRole("search").getByRole("searchbox", { name: "Search" }),
  ).toBeVisible();
  await openNavigation(page);
  const rail = page.getByRole("complementary", { name: "Desk navigation" });
  await expect(rail.getByRole("link", { name: "Pythia home" })).toHaveAttribute(
    "href",
    "/",
  );
  for (const name of ["Chat", "Markets", "Watchlist", "Workspace", "Filings"]) {
    await expect(rail.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(
    rail.getByRole("link", { name: "Chat", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Settings" })).toBeVisible();

  const chats = page.getByRole("navigation", { name: "Chats" });
  // Search is an affordance, not a permanent field, so the header stays quiet.
  await expect(
    chats.getByRole("button", { name: "Search chats" }),
  ).toBeVisible();
  await expect(
    chats.getByRole("searchbox", { name: "Search chats" }),
  ).toHaveCount(0);
  await expect(chats.getByRole("button", { name: "New chat" })).toBeVisible();
  await expect(chats.getByRole("heading", { name: "Pinned" })).toBeVisible();
  await expect(page.getByText("Loading chats…")).toHaveCount(0);
});

test("filters the chat list and restores it when the query is cleared", async ({
  page,
}) => {
  await openDesk(page);
  await openNavigation(page);
  const links = await chatLinks(page);
  const total = await links.count();
  test.skip(total === 0, "This Hermes profile has no chats yet.");
  const chats = page.getByRole("navigation", { name: "Chats" });
  await chats.getByRole("button", { name: "Search chats" }).click();
  const search = chats.getByRole("searchbox", { name: "Search chats" });
  await expect(search).toBeFocused();
  await search.fill("zzz-no-chat-should-match-zzz");
  await expect(page.getByText("No chats match.")).toBeVisible();
  // Escape closes the field and clears the filter with it.
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(
    chats.getByRole("button", { name: "Search chats" }),
  ).toBeFocused();
  await expect(links).toHaveCount(total);
});

test("reaches a reserved destination and names it in the top bar", async ({
  page,
}) => {
  await openDesk(page);
  await openNavigation(page);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect(
    page.getByRole("search").getByText("Markets", { exact: true }),
  ).toBeVisible();
  // The chat list belongs to Chat, so it steps aside on other destinations.
  await expect(page.getByRole("navigation", { name: "Chats" })).toHaveCount(0);
});

test("settings follows the device by default and can override it", async ({
  page,
}) => {
  await openDesk(page);
  await openNavigation(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const html = page.locator("html");
  const trigger = page.getByRole("combobox", { name: "Theme" });
  await expect(trigger).toHaveText("System");
  await expect(html).toHaveAttribute("data-theme-preference", "system");

  const target =
    (await html.getAttribute("data-theme")) === "dark" ? "Light" : "Dark";
  await trigger.click();
  await page.getByRole("option", { name: target }).click();
  await expect(html).toHaveAttribute("data-theme", target.toLowerCase());
  await expect(html).toHaveAttribute(
    "data-theme-preference",
    target.toLowerCase(),
  );

  // Returning to System hands control back to the device.
  await trigger.click();
  await page.getByRole("option", { name: "System" }).click();
  await expect(html).toHaveAttribute("data-theme-preference", "system");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Theme" })).toHaveText(
    "System",
  );
});

test("docks Pythia beside a page and keeps the open conversation", async ({
  page,
}) => {
  test.skip(isNarrow(page), "The dock needs a wide viewport.");
  await openDesk(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chat to carry into the dock.");
  const title = await links.first().innerText();
  await links.first().click();
  await page.waitForURL(/\/c\//);

  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await expect(page).toHaveURL(/\/markets$/);
  const dock = page.getByRole("complementary", { name: "Pythia" });
  await expect(dock).toBeVisible();
  // The dock carries the conversation across, it does not start a new one.
  await expect(
    dock.getByRole("tab", { name: title, exact: true }),
  ).toBeVisible();

  await dock.getByRole("button", { name: "Hide Pythia" }).click();
  await expect(dock).toHaveCount(0);
  await page.getByRole("button", { name: "Open Pythia" }).click();
  await expect(dock).toBeVisible();
});

test("keeps open chats as tabs and swaps without leaving the page", async ({
  page,
}) => {
  test.skip(isNarrow(page), "The dock needs a wide viewport.");
  await openDesk(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) < 2, "Need two chats to swap between.");
  const first = await links.first().innerText();
  const second = await links.nth(1).innerText();
  await links.first().click();
  await page.waitForURL(/\/c\//);
  await page.getByRole("link", { name: "Markets", exact: true }).click();

  const dock = page.getByRole("complementary", { name: "Pythia" });
  const tabs = dock.getByRole("tablist");
  // The chat you came from travels to the dock as a tab.
  await expect(tabs.getByRole("tab", { name: first })).toBeVisible();

  // Everything else is a dropdown behind the clock, not a second panel.
  const openHistory = async () => {
    await dock.getByRole("button", { name: "Chat history" }).click();
    return page.getByRole("dialog");
  };
  let history = await openHistory();
  await expect(
    history.getByRole("searchbox", { name: "Search chats" }),
  ).toBeFocused();
  await history.getByRole("button", { name: second, exact: true }).click();
  // Picking from it closes the dropdown rather than covering the conversation.
  await expect(history).toHaveCount(0);

  // Picking a chat opens it as a second tab and stays on Markets.
  await expect(page).toHaveURL(/\/markets$/);
  await expect(tabs.getByRole("tab", { name: second })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs.getByRole("tab")).toHaveCount(2);

  // A chat that already has a tab is marked, and picking it moves to that tab
  // rather than opening a second one.
  history = await openHistory();
  await expect(history.getByText("Open").first()).toBeVisible();
  await history.getByRole("button", { name: first, exact: true }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await expect(tabs.getByRole("tab", { name: first })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Closing the active tab falls back to its neighbour, still on Markets.
  await dock.getByRole("button", { name: `Close ${second}` }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(1);
  await expect(page).toHaveURL(/\/markets$/);
});

test("starts a new chat inside the dock without leaving the page", async ({
  page,
}) => {
  test.skip(isNarrow(page), "The dock needs a wide viewport.");
  await openDesk(page);
  await page.getByRole("link", { name: "Markets", exact: true }).click();
  await expect(page).toHaveURL(/\/markets$/);

  const dock = page.getByRole("complementary", { name: "Pythia" });
  await dock.getByRole("button", { name: "New chat" }).click();
  // The unsaved chat is a tab of its own, and Markets stays on screen.
  await expect(dock.getByRole("tab", { name: "New chat" })).toBeVisible();
  await expect(
    dock.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/markets$/);
});

test("hides and restores the chat list on wide viewports", async ({ page }) => {
  test.skip(isNarrow(page), "The list is a drawer on narrow viewports.");
  await openDesk(page);
  const chats = page.getByRole("navigation", { name: "Chats" });
  await expect(chats).toBeVisible();
  await page.getByRole("button", { name: "Hide chats" }).click();
  await expect(chats).toBeHidden();
  await page.getByRole("button", { name: "Show chats" }).click();
  await expect(chats).toBeVisible();
});

test("names the open conversation above the thread", async ({ page }) => {
  test.skip(isNarrow(page), "The chat header is a wide-viewport line.");
  await openDesk(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "This Hermes profile has no chats.");
  const title = await links.first().innerText();
  await links.first().click();
  await page.waitForURL(/\/c\//);
  const header = page.locator('[data-slot="chat-header"]');
  await expect(header).toContainText(title);
  // With the list beside the column its controls would only be a second copy.
  await expect(header.getByRole("button", { name: "Show chats" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Hide chats" }).click();
  await expect(
    header.getByRole("button", { name: "Show chats" }),
  ).toBeVisible();
  await expect(header.getByRole("button", { name: "New chat" })).toBeVisible();
});

test("opens a chat at its own route and marks it current", async ({ page }) => {
  await openDesk(page);
  await openNavigation(page);
  const links = await chatLinks(page);
  test.skip(
    (await links.count()) === 0,
    "This Hermes profile has no chats yet.",
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
  await openDesk(page);
  await openNavigation(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chats to navigate away from.");
  await links.first().click();
  await page.waitForURL(/\/c\//);
  await openNavigation(page);
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeFocused();
});

test("the Pythia wordmark returns home and focuses the composer", async ({
  page,
}) => {
  await openDesk(page);
  await openNavigation(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chats to navigate away from.");
  await links.first().click();
  await page.waitForURL(/\/c\//);
  await openNavigation(page);
  await page.getByRole("link", { name: "Pythia home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeFocused();
});

test("keyboard reaches New chat and the chat row controls", async ({
  page,
}) => {
  test.skip(
    isNarrow(page),
    "Keyboard traversal is checked on the desktop project.",
  );
  await openDesk(page);
  const links = await chatLinks(page);
  test.skip((await links.count()) === 0, "No chats to focus.");
  const home = page.getByRole("link", { name: "Pythia home" });
  await home.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Collapse navigation" }),
  ).toBeFocused();
  await links.first().focus();
  await page.keyboard.press("Tab");
  const actions = page
    .getByRole("button", { name: /^Chat actions for / })
    .first();
  await expect(actions).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
});

test("the drawer opens and closes on narrow viewports", async ({ page }) => {
  test.skip(!isNarrow(page), "Drawer behavior belongs to the phone project.");
  await openDesk(page);
  const navigation = page.getByRole("complementary", {
    name: "Desk navigation",
  });
  await expect(navigation).not.toBeInViewport();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(navigation).toBeInViewport();
  // The scrim sits behind the drawer; tap the uncovered strip beside it.
  const viewport = page.viewportSize() ?? { width: 412, height: 915 };
  await page.mouse.click(viewport.width - 24, viewport.height / 2);
  await expect(navigation).not.toBeInViewport();
});
