import { expect, type Page, test } from "@playwright/test";
import { openDesk, showChats } from "./open-desk";

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
  // The core bar's "Search" field, or the default investment-search top bar,
  // whose field is a combobox. On a phone the core bar folds its field behind
  // a "Search" button, which the investment-search bar does not.
  const bar = page.getByRole("search");
  const field = bar
    .getByRole("searchbox", { name: "Search", exact: true })
    .or(bar.getByRole("combobox", { name: "Search investments" }));
  const fold = bar.getByRole("button", { name: "Search", exact: true });
  await expect(
    (isNarrow(page) ? field.or(fold) : field).filter({ visible: true }),
  ).toBeVisible();
  await openNavigation(page);
  const rail = page.getByRole("complementary", { name: "Desk navigation" });
  await expect(rail.getByRole("link", { name: "Pythia home" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(
    rail.getByRole("link", { name: "Chat", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Settings" })).toBeVisible();
  // The menu holds the rail only; the chat list keeps its own place, opened
  // on a phone from the chat header.
  const chats = page.getByRole("navigation", { name: "Chats" });
  if (isNarrow(page)) {
    await expect(rail.getByRole("navigation", { name: "Chats" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show chats" }).click();
  }
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
  await showChats(page);
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
  await expect(page).toHaveURL(/\?settings=$/);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Appearance" })
    .click();

  const html = page.locator("html");
  const theme = settings.getByRole("group", { name: "Theme" });
  const choice = (name: string) =>
    theme.getByRole("button", { name, exact: true });
  await expect(choice("System")).toHaveAttribute("aria-pressed", "true");
  await expect(html).toHaveAttribute("data-theme-preference", "system");

  const target =
    (await html.getAttribute("data-theme")) === "dark" ? "Light" : "Dark";
  await choice(target).click();
  await expect(html).toHaveAttribute("data-theme", target.toLowerCase());
  await expect(html).toHaveAttribute(
    "data-theme-preference",
    target.toLowerCase(),
  );

  // Returning to System hands control back to the device.
  await choice("System").click();
  await expect(html).toHaveAttribute("data-theme-preference", "system");
  await page.reload();
  await expect(choice("System")).toHaveAttribute("aria-pressed", "true");
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
  await showChats(page);
  const links = await chatLinks(page);
  test.skip(
    (await links.count()) === 0,
    "This Hermes profile has no chats yet.",
  );
  const first = links.first();
  const href = await first.getAttribute("href");
  await first.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await showChats(page);
  await expect(
    page
      .getByRole("navigation", { name: "Chats" })
      .locator('a[aria-current="page"]'),
  ).toHaveCount(1);
});

for (const [name, trigger] of [
  [
    "New chat",
    async (page: Page) => page.getByRole("button", { name: "New chat" }),
  ],
  [
    "The Pythia wordmark",
    async (page: Page) => {
      await openNavigation(page);
      return page.getByRole("link", { name: "Pythia home" });
    },
  ],
] as const) {
  test(`${name} returns to the root route and focuses the composer`, async ({
    page,
  }) => {
    await openDesk(page);
    await showChats(page);
    const links = await chatLinks(page);
    test.skip((await links.count()) === 0, "No chats to navigate away from.");
    await links.first().click();
    await page.waitForURL(/\/c\//);
    await (await trigger(page)).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("textbox", { name: "Message Pythia" }),
    ).toBeFocused();
  });
}

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
