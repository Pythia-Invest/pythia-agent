import { expect, type Page } from "@playwright/test";

/** Wait on the initial API response before checking rendering. A cold Next
 * development route can compile longer than an assertion's UI deadline. */
export async function openDesk(page: Page) {
  const sessions = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/sessions" &&
      response.request().method() === "GET",
  );
  await page.goto("/");
  expect((await sessions).ok()).toBe(true);
}
