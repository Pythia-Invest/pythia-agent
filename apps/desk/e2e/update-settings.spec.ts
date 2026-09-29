import { expect, type Page, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

/** The browser remembers today's check, so a test starts without one. */
async function checkedToday(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pythia.updates.checked-at",
      String(Date.now()),
    );
  });
}

/** Settings › Updates: a tab beside the page, or a select on a narrow screen. */
async function openUpdates(page: Page) {
  await page.goto("/settings");
  if ((page.viewportSize()?.width ?? 1280) >= 640) {
    await page.getByRole("tab", { name: "Updates", exact: true }).click();
  } else {
    await page.getByRole("combobox", { name: "Settings section" }).click();
    await page.getByRole("option", { name: "Updates", exact: true }).click();
  }
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
  await expect.poll(() => sawActivation, { timeout: 12_000 }).toBe(true);
  await expect(panel.getByRole("button", { name: "Reload Desk" })).toHaveCount(
    0,
  );
  installed = {
    ...installed,
    last_update: { phase: "complete", target_revision: target },
  };
  await expect(panel).toContainText("The update is installed.", {
    timeout: 12_000,
  });
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

test("does not mistake a failed update on the target build for completion", async ({
  page,
}) => {
  await updateFixture(page);
  let installed: Record<string, unknown> = { ...inventory };
  await page.route("**/api/update-status**", async (route) => {
    if (route.request().method() === "POST") {
      installed = {
        ...inventory,
        current_revision: target,
        updater: "failed",
        last_update: { phase: "failed-stopped", target_revision: target },
      };
      return route.fulfill({
        json: { started: true, target_revision: target },
      });
    }
    return route.fulfill({
      json: new URL(route.request().url()).searchParams.has("check")
        ? update
        : installed,
    });
  });
  await openUpdates(page);
  const panel = page.locator('[data-slot="update-status"]');
  await panel.getByRole("button", { name: "Check now", exact: true }).click();
  await panel.getByRole("button", { name: "Update now" }).click();
  await expect(panel).toContainText("The update didn't finish.");
  await expect(panel).toContainText("pythia recover");
  await expect(panel.getByRole("button", { name: "Reload Desk" })).toHaveCount(
    0,
  );
});

test("shows a rejected prerequisite without claiming an update started", async ({
  page,
}) => {
  await updateFixture(page);
  let writes = 0;
  await page.route("**/api/update-status**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "target_prerequisites_pending",
            message:
              "Workspace transition pending. Preview with pythia workspace-transition.",
          },
        },
      });
    }
    return route.fulfill({
      json: new URL(route.request().url()).searchParams.has("check")
        ? update
        : inventory,
    });
  });
  await openUpdates(page);
  const panel = page.locator('[data-slot="update-status"]');
  await panel.getByRole("button", { name: "Check now", exact: true }).click();
  await panel.getByRole("button", { name: "Update now" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "pythia workspace-transition",
  );
  await expect(panel).not.toContainText("Updating Pythia");
  await expect(panel.getByRole("button", { name: "Reload Desk" })).toHaveCount(
    0,
  );
  expect(writes).toBe(1);
});

test("checks once a day on its own and marks a ready update in the sidebar", async ({
  page,
}) => {
  await fixture(page);
  let checks = 0;
  await page.route("**/api/update-status**", (route) => {
    if (new URL(route.request().url()).searchParams.has("check")) {
      checks++;
      return route.fulfill({ json: update });
    }
    return route.fulfill({ json: inventory });
  });
  // The fixture's own first page already counted as today's check.
  await page.evaluate(() =>
    window.localStorage.removeItem("pythia.updates.checked-at"),
  );
  await page.goto("/");
  await expect.poll(() => checks).toBe(1);
  if ((page.viewportSize()?.width ?? 1280) < 900)
    await page.getByRole("button", { name: "Open navigation" }).click();
  const indicator = page.getByRole("button", { name: "Update available" });
  await indicator.click();
  const dialog = page.getByRole("dialog", { name: "New update available" });
  await expect(
    dialog.getByRole("button", { name: "Update now" }),
  ).toBeEnabled();
  // Checked today: a reload does not check again.
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(checks).toBe(1);
});
