import { expect, type Page, test } from "@playwright/test";
import { checkedToday, hermesSettings } from "./settings-fixture";
import { fixture, isPhone } from "./stream-fixture";

/** Settings › About › Version & updates, in the Settings dialog. */
async function openUpdates(page: Page) {
  await page.goto("/?settings=about/updates");
}

const current = "a".repeat(40);
const target = "b".repeat(40);
const inventory = {
  status: "ready",
  channel: "preview",
  current_version: "main",
  current_revision: current,
  apply_supported: true,
  updater: "idle",
};
const update = {
  ...inventory,
  update_available: true,
  target_revision: target,
  target_version: "main",
  checkout_clean: true,
};

async function updateFixture(page: Page) {
  await checkedToday(page);
  const state = await fixture(page);
  await hermesSettings(page);
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      json: {
        model_auth: {
          provider: "openai-codex",
          status: "missing",
          setup_command: "hermes auth login",
        },
        skills_status: "ready",
        skills: [],
        toolsets_status: "ready",
        toolsets: [],
        workspace: { root: null, native_cwd: null, status: "unavailable" },
      },
    }),
  );
  return state;
}

test("checks explicitly, pins the selected build, and reconnects after an ambiguous restart", async ({
  page,
}) => {
  // The updater is polled while an update runs; advance the page clock
  // past each poll instead of waiting it out.
  await page.clock.install();
  const state = await updateFixture(page);
  let checks = 0;
  let installed: Record<string, unknown> = { ...inventory };
  let writes = 0;
  let restart = false;
  let sawActivation = false;
  await page.route("**/api/update-status**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      expect(route.request().postDataJSON()).toEqual({ current, target });
      restart = true;
      return route.abort("connectionreset");
    }
    if (new URL(route.request().url()).searchParams.has("check")) {
      checks++;
      return route.fulfill({ json: update });
    }
    if (installed.current_revision === target && !installed.last_update)
      sawActivation = true;
    return route.fulfill({ json: installed });
  });
  await openUpdates(page);
  const panel = page.locator('[data-slot="update-status"]');
  await expect(
    page.getByText(`Version main · Preview · ${current.slice(0, 7)}`),
  ).toBeVisible();
  expect(checks).toBe(0);
  await panel.getByRole("button", { name: "Check now", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Update now" })).toBeEnabled();
  await panel.getByRole("button", { name: "Update now" }).click();
  await expect.poll(() => restart).toBe(true);
  await expect(panel).toContainText("Updating Pythia");
  installed = { ...inventory, current_revision: target };
  // Activation can precede health verification and transaction completion.
  await page.clock.runFor(3_000);
  await expect.poll(() => sawActivation).toBe(true);
  await expect(panel.getByRole("button", { name: "Reload Desk" })).toHaveCount(
    0,
  );
  installed = {
    ...installed,
    last_update: { phase: "complete", target_revision: target },
  };
  await page.clock.runFor(3_000);
  await expect(panel).toContainText("The update is installed.");
  await expect(
    panel.getByRole("button", { name: "Reload Desk" }),
  ).toBeVisible();
  expect(writes).toBe(1);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("keeps build identity through a failed check and disables updating local changes", async ({
  page,
}) => {
  await updateFixture(page);
  let broken = true;
  let writes = 0;
  await page.route("**/api/update-status**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      return route.fulfill({ status: 500 });
    }
    const check = new URL(route.request().url()).searchParams.has("check");
    return route.fulfill({
      json: !check
        ? inventory
        : broken
          ? {
              ...inventory,
              status: "unavailable",
              message: "Update server unavailable",
            }
          : { ...update, checkout_clean: false },
    });
  });
  await openUpdates(page);
  const panel = page.locator('[data-slot="update-status"]');
  await panel.getByRole("button", { name: "Check now", exact: true }).click();
  await expect(panel).toContainText("Update server unavailable");
  await expect(
    page.getByText(`Version main · Preview · ${current.slice(0, 7)}`),
  ).toBeVisible();
  broken = false;
  await panel.getByRole("button", { name: "Check now", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "Update now" }),
  ).toBeDisabled();
  await expect(panel).toContainText("Local source changes need attention");
  expect(writes).toBe(0);
});

test("development shows its build without offering an installed update", async ({
  page,
}) => {
  await updateFixture(page);
  await page.route("**/api/update-status**", (route) =>
    route.fulfill({
      json: {
        status: "unavailable",
        current_version: "Development",
        current_revision: current,
        apply_supported: false,
        code: "release_command_unavailable",
        message:
          "Application updates are available on an installed Pythia device.",
      },
    }),
  );
  await openUpdates(page);
  const panel = page.locator('[data-slot="update-status"]');
  await expect(panel).toContainText(
    "This build can't update itself from here.",
  );
  await expect(
    page.getByText(`Development build ${current.slice(0, 7)}`),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: "Update now" })).toHaveCount(
    0,
  );
  await expect(panel.getByRole("button", { name: "Check now" })).toHaveCount(0);
});

const failedTarget = {
  ...inventory,
  current_revision: target,
  updater: "failed",
  last_update: { phase: "failed-stopped", target_revision: target },
};
const started = { json: { started: true, target_revision: target } };
const startFailures: {
  name: string;
  installed?: Record<string, unknown>;
  /** Shown before checking. */
  before?: string;
  button?: string;
  start: { status?: number; json: unknown };
  /** What the updater reports once the start reply is in. */
  after?: Record<string, unknown>;
  /** Poll time to let pass before the verdict. */
  wait?: number;
  alert?: string;
  shows?: string[];
  /** Nothing began, so nothing may claim it did. */
  idle?: boolean;
}[] = [
  {
    name: "shows a rejected prerequisite without claiming an update started",
    start: {
      status: 409,
      json: {
        error: {
          code: "target_prerequisites_pending",
          message:
            "Workspace transition pending. Preview with pythia workspace-transition.",
        },
      },
    },
    alert: "pythia workspace-transition",
    idle: true,
  },
  {
    name: "does not mistake a failed update on the target build for completion",
    start: started,
    after: failedTarget,
    shows: ["The update didn't finish.", "pythia recover"],
  },
  {
    name: "offers another attempt after an earlier failure",
    installed: { ...inventory, updater: "failed" },
    before: "An earlier update attempt failed.",
    button: "Try again",
    start: started,
  },
  {
    name: "says an update did not start when its start reply was lost and nothing changed",
    start: {
      status: 503,
      json: {
        error: {
          code: "update_start_unconfirmed",
          message: "Desk could not confirm that the update started.",
        },
      },
    },
    // The idle updater on the same build a few seconds later proves nothing began.
    wait: 6_000,
    alert: "could not confirm that the update started",
    idle: true,
  },
];

for (const row of startFailures)
  test(row.name, async ({ page }) => {
    await page.clock.install();
    await updateFixture(page);
    let installed = row.installed ?? inventory;
    let writes = 0;
    await page.route("**/api/update-status**", (route) => {
      if (route.request().method() === "POST") {
        writes++;
        if (row.after) installed = row.after;
        return route.fulfill(row.start);
      }
      return route.fulfill({
        json: new URL(route.request().url()).searchParams.has("check")
          ? { ...update, updater: installed.updater }
          : installed,
      });
    });
    await openUpdates(page);
    const panel = page.locator('[data-slot="update-status"]');
    if (row.before) await expect(panel).toContainText(row.before);
    await panel.getByRole("button", { name: "Check now", exact: true }).click();
    const start = panel.getByRole("button", {
      name: row.button ?? "Update now",
    });
    await expect(start).toBeEnabled();
    await start.click();
    await expect.poll(() => writes).toBe(1);
    if (row.wait) await page.clock.runFor(row.wait);
    if (row.alert)
      await expect(panel.getByRole("alert")).toContainText(row.alert);
    for (const text of row.shows ?? []) await expect(panel).toContainText(text);
    if (row.idle) {
      await expect(panel).not.toContainText("Updating Pythia");
      await expect(
        panel.getByRole("button", { name: "Update now" }),
      ).toBeEnabled();
    }
    await expect(
      panel.getByRole("button", { name: "Reload Desk" }),
    ).toHaveCount(0);
    expect(writes).toBe(1);
  });

test("checks once a day on its own and marks a ready update in the sidebar", async ({
  page,
}) => {
  const day = 86_400_000;
  await page.clock.install();
  await fixture(page);
  await hermesSettings(page);
  let checks = 0;
  const checked = () =>
    page.waitForResponse((response) =>
      new URL(response.url()).searchParams.has("check"),
    );
  await page.route("**/api/update-status**", (route) => {
    if (new URL(route.request().url()).searchParams.has("check")) {
      checks++;
      return route.fulfill({ json: update });
    }
    return route.fulfill({ json: inventory });
  });
  // The fixture's first page was today's check; a day later a load checks.
  await page.clock.fastForward(day + 60_000);
  let next = checked();
  await page.goto("/");
  await next;
  expect(checks).toBe(1);
  if (isPhone(page))
    await page.getByRole("button", { name: "Open navigation" }).click();
  const indicator = page.getByRole("button", { name: "Update available" });
  await indicator.click();
  const dialog = page.getByRole("dialog", { name: "New update available" });
  await expect(
    dialog.getByRole("button", { name: "Update now" }),
  ).toBeEnabled();
  // Within the day neither a reload nor a return to the window checks; past
  // it, returning does. A check wrongly made earlier would be counted first.
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Message Pythia" }),
  ).toBeVisible();
  await page.clock.fastForward(day - 60_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.fastForward(120_000);
  next = checked();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await next;
  expect(checks).toBe(2);
});
