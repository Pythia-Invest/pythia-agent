import { expect, test } from "@playwright/test";

/** Read-only qualification against the configured host workspace. API calls are
 * blocked; the initial admitted HTML must suffice even without application JS. */
test("initial folder is visible before JavaScript and survives hydration", async ({
  page,
}, info) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          message: "API deliberately unavailable in initial-render check",
        },
      },
    }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, async (route) => {
    await gate;
    await route.continue();
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|did not match/i.test(message.text())
    )
      errors.push(message.text());
  });
  await page.goto("/workspace", { waitUntil: "commit" });
  const files = page.locator('[data-slot="workspace-file-list"]');
  let count = 0;
  try {
    await expect(files).toBeVisible();
    await expect(
      page.getByText("Opening workspace…", { exact: true }),
    ).toHaveCount(0);
    count = await files.getByRole("listitem").count();
  } finally {
    release();
  }
  await page.waitForLoadState("load");
  // Observe an event-driven state change, not just the presence of SSR controls.
  if (info.project.name === "desktop") {
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-desk-rail-collapsed",
      "true",
    );
  } else {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("dialog", { name: "Navigation", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await expect(files).toBeVisible();
  await expect(files.getByRole("listitem")).toHaveCount(count);
  expect(errors).toEqual([]);
});
