import { expect, type Page, test } from "@playwright/test";

/**
 * Chat surface smoke. These tests never send a prompt: that would start a
 * real Hermes run against a real model. They cover the surfaces around it.
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

async function openNavigation(page: Page) {
  if (!isPhone(page)) return;
  await page.getByRole("button", { name: "Open navigation" }).click();
}

test("the new-chat surface offers a composer that only enables with text", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What are we looking into?" }),
  ).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Pythia" });
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeDisabled();
  await input.fill("draft that is never sent");
  await expect(send).toBeEnabled();
  await input.fill("");
  await expect(send).toBeDisabled();
});

test("an existing chat renders its transcript and a composer", async ({
  page,
}) => {
  await page.goto("/");
  await openNavigation(page);
  await expect(page.getByText("Loading chats…")).toHaveCount(0);
  const links = page
    .getByRole("navigation", { name: "Chats" })
    .getByRole("link");
  test.skip((await links.count()) === 0, "This Hermes profile has no chats.");
  await links.first().click();
  await expect(page).toHaveURL(/\/c\//);
  await expect(page.getByText("Loading conversation…")).toHaveCount(0);
  // Seeded profiles may hold title-only sessions; either a transcript or the
  // explicit empty state must be present, never a blank surface.
  await expect(
    page
      .locator('[data-slot="message"]')
      .first()
      .or(page.locator('[data-slot="conversation-empty"]')),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
});
