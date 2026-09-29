import { expect, test } from "@playwright/test";
import { checkedToday, providers, settingsFixture } from "./settings-fixture";

test("Hermes settings save on their own, sending only what changed", async ({
  page,
}) => {
  await checkedToday(page);
  const state = await settingsFixture(page);
  await page.goto("/?settings=chat/behavior");
  await page.getByRole("switch", { name: "Reasoning blocks" }).click();
  await expect
    .poll(() => state.writes.map((write) => write.body))
    .toContainEqual({ values: { "display.show_reasoning": false } });
  expect(state.writes.at(-1)).toMatchObject({
    method: "PATCH",
    path: "/api/hermes/config",
  });
  // A choice Hermes's schema calls a string gets Hermes Desktop's options.
  await page.goto("/?settings=safety/approvals");
  await page.getByRole("combobox", { name: "Approval mode" }).click();
  await page.getByRole("option", { name: "Smart" }).click();
  await expect
    .poll(() => state.writes.map((write) => write.body))
    .toContainEqual({ values: { "approvals.mode": "smart" } });
  expect(state.unexpected).toEqual([]);
});

test("a credential saves in place and comes back only as a stand-in", async ({
  page,
}) => {
  await checkedToday(page);
  await settingsFixture(page);
  const view = structuredClone(providers);
  const key: ((typeof view.keys)[number] & { hint?: string }) | undefined =
    view.keys[0];
  if (!key) throw new Error("Missing synthetic provider key");
  const writes: unknown[] = [];
  let reject = true;
  await page.route("**/api/hermes/providers", (route) =>
    route.fulfill({ json: view }),
  );
  await page.route("**/api/hermes/keys", (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    if (reject)
      return route.fulfill({
        status: 400,
        json: { error: { message: "Synthetic credential rejected" } },
      });
    key.set = body.value !== null;
    if (key.set) key.hint = "9a7c";
    else delete key.hint;
    return route.fulfill({ json: view });
  });
  await page.goto("/?settings=providers/keys");
  const field = page.getByRole("textbox", { name: "Synthetic API key" });
  await field.fill("synthetic-key-0000-9a7c");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Synthetic credential rejected")).toBeVisible();
  // A rejected value stays for correcting; nothing claims it saved.
  await expect(field).toHaveValue("synthetic-key-0000-9a7c");
  reject = false;
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("textbox", { name: "Synthetic API key" }),
  ).toHaveValue("•••• 9a7c");
  expect(writes.at(-1)).toEqual({
    key: "SYNTHETIC_API_KEY",
    value: "synthetic-key-0000-9a7c",
  });
  await page.getByRole("textbox", { name: "Synthetic API key" }).focus();
  await page.getByRole("button", { name: "Remove Synthetic API key" }).click();
  await expect
    .poll(() => writes.at(-1))
    .toEqual({ key: "SYNTHETIC_API_KEY", value: null });
});

test("provider keys and accounts go through Hermes, not the browser", async ({
  page,
}) => {
  await checkedToday(page);
  const state = await settingsFixture(page);
  await page.goto("/?settings=providers/keys");
  await page
    .getByRole("textbox", { name: "Synthetic API key" })
    .fill("synthetic-key-9a7c");
  await page.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => state.writes.at(-1))
    .toEqual({
      method: "POST",
      path: "/api/hermes/keys",
      body: { key: "SYNTHETIC_API_KEY", value: "synthetic-key-9a7c" },
    });
  await page.goto("/?settings=providers/accounts");
  const connected = page.getByRole("region", { name: "Connected" });
  await expect(connected).toContainText("Synthetic Subscription");
  await expect(connected).toContainText("Signed in via Synthetic Portal");
  await page.getByRole("button", { name: /Show 1/ }).click();
  // A provider that signs in outside Hermes shows its command to run.
  await expect(page.getByText("synthetic login")).toBeVisible();
  expect(state.unexpected).toEqual([]);
});
