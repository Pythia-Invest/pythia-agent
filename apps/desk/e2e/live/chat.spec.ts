import { expect, test } from "@playwright/test";
import { openDesk, showChats } from "./open-desk";

/**
 * Chat surface smoke. These tests never send a prompt: that would start a
 * real Hermes run against a real model. They cover the surfaces around it.
 */

/** The chat list: beside the conversation on desktop, opened over it on a
 * phone from the chat header, as on desktop when it is hidden. */
test("the new-chat surface offers a composer that only enables with text", async ({
  page,
}) => {
  await openDesk(page);
  await expect(
    page.getByRole("heading", { name: "What are you working on?" }),
  ).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Pythia" });
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeDisabled();
  await input.fill("draft that is never sent");
  await expect(send).toBeEnabled();
  await input.fill("");
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(input).toBeFocused();
});

test("an existing chat renders its transcript and a composer", async ({
  page,
}) => {
  await openDesk(page);
  await showChats(page);
  await expect(page.getByText("Loading chats…")).toHaveCount(0);
  const links = page
    .getByRole("navigation", { name: "Chats" })
    .getByRole("link");
  test.skip((await links.count()) === 0, "This Hermes profile has no chats.");
  const messages = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/messages") &&
      response.request().method() === "GET",
  );
  await links.first().click();
  await page.waitForURL(/\/c\//);
  expect((await messages).ok()).toBe(true);
  await expect(page.getByText("Loading conversation…")).toHaveCount(0);
  // Seeded profiles may hold title-only sessions; either a transcript or the
  // opening a new chat shows must be present, never a blank surface.
  await expect(
    page
      .locator('[data-slot="message"]')
      .first()
      .or(page.locator('[data-slot="chat-opening"]')),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeDisabled();
});
