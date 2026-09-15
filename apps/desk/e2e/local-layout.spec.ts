import { expect, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

test("saved navigation is applied before application JavaScript and survives hydration", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await fixture(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "pythia-desk.shell",
      JSON.stringify({
        railCollapsed: true,
        listOpen: false,
        dockOpen: true,
        dockWidth: 610,
      }),
    ),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydrat|did not match/i.test(message.text())
    )
      errors.push(message.text());
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, async (route) => {
    await pending;
    await route.continue();
  });
  await page.reload({ waitUntil: "commit" });
  const nav = page.locator('[aria-label="Desk navigation"]').first();
  try {
    await expect(nav).toHaveCSS("width", "60px");
    await expect(
      page.getByRole("button", { name: "Expand navigation" }),
    ).toBeVisible();
    await expect(page.locator('[aria-label="Chats"]')).toBeHidden();
  } finally {
    release();
  }
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await expect(nav).toHaveCSS("width", "60px");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(nav).toHaveCSS("width", "224px");
  await page.reload();
  await expect(nav).toHaveCSS("width", "224px");
  expect(errors).toEqual([]);
});

test("dock restores width, persists a completed resize and reopens", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop");
  await fixture(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "pythia-desk.shell",
      JSON.stringify({ railCollapsed: true, dockOpen: true, dockWidth: 610 }),
    ),
  );
  await page.goto("/markets");
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/_next\/.*\.js(?:\?|$)/, async (route) => {
    await pending;
    await route.continue();
  });
  await page.reload({ waitUntil: "commit" });
  const dock = page.locator('[data-layout-panel="dock"]');
  try {
    await expect
      .poll(async () => Math.round((await dock.boundingBox())?.width ?? 0))
      .toBe(610);
  } finally {
    release();
  }
  await expect(page.locator('[data-slot="shell-dock-layout"]')).toHaveAttribute(
    "data-restored",
    "true",
  );
  await expect
    .poll(async () => Math.round((await dock.boundingBox())?.width ?? 0))
    .toBe(610);
  const separator = page.getByRole("separator", { name: "Resize Pythia" });
  const box = await separator.boundingBox();
  if (!box) throw new Error("Missing separator");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 100, { steps: 8 });
  await page.mouse.up();
  const width = (await dock.boundingBox())?.width ?? 0;
  expect(width).toBeLessThan(560);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pythia-desk.shell") ?? "{}")
            .dockWidth,
      ),
    )
    .toBeCloseTo(width, 0);
  await page.getByRole("button", { name: "Hide Pythia" }).click();
  await expect(dock).toBeHidden();
  await page.reload();
  await expect(dock).toBeHidden();
  await page.getByRole("button", { name: "Open Pythia" }).click();
  await expect
    .poll(async () => Math.round((await dock.boundingBox())?.width ?? 0))
    .toBe(Math.round(width));
});

test("desktop preferences leave mobile navigation expanded and dock optional", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone");
  await page.addInitScript(() =>
    localStorage.setItem(
      "pythia-desk.shell",
      JSON.stringify({
        railCollapsed: true,
        listOpen: false,
        dockOpen: true,
        dockWidth: 610,
      }),
    ),
  );
  await fixture(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const navigation = page.getByRole("dialog", {
    name: "Navigation",
    exact: true,
  });
  await expect(
    navigation.getByRole("link", { name: "Workspace", exact: true }),
  ).toBeVisible();
  await expect(
    navigation.getByText("Workspace", { exact: true }),
  ).not.toHaveCSS("position", "absolute");
  await navigation.getByRole("link", { name: "Markets", exact: true }).click();
  await expect(page.locator('[data-layout-panel="dock"]')).toBeHidden();
  await page.getByRole("button", { name: "Open Pythia" }).click();
  await expect(page.getByRole("dialog", { name: "Pythia chat" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
