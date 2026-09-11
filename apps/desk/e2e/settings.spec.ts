import { expect, type Page, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

async function section(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await page.getByRole("combobox", { name: "Settings section" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  } else await page.getByRole("tab", { name, exact: true }).click();
}

test("native settings save, clear, and toggle through the existing API", async ({
  page,
}) => {
  const state = await fixture(page);
  const snapshot = {
    model_auth: {
      provider: "openai-codex",
      status: "missing",
      setup_command: "hermes auth login",
    },
    sec_identity: { status: "missing" },
    eodhd_credential: { status: "missing" },
    basic_memory: { status: "ready" },
    skills_status: "ready",
    skills: [
      {
        name: "Synthetic skill",
        enabled: false,
        mutable: true,
        kind: "other-hermes-skill",
      },
      {
        name: "Required skill",
        enabled: true,
        mutable: false,
        kind: "other-hermes-skill",
      },
    ],
    toolsets_status: "ready",
    toolsets: [
      {
        name: "synthetic-tools",
        label: "Synthetic tools",
        enabled: false,
        configured: true,
        tools: [],
      },
    ],
  };
  const writes: unknown[] = [];
  let rejectCredential = true;
  await page.route("**/api/settings**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ json: snapshot });
    const body = request.postDataJSON();
    writes.push({ path, body });
    if (path.endsWith("sec-identity")) {
      snapshot.sec_identity.status =
        body.identity === null ? "missing" : "configured";
      return route.fulfill({ json: snapshot.sec_identity });
    }
    if (path.endsWith("eodhd-token")) {
      if (rejectCredential)
        return route.fulfill({
          status: 400,
          json: {
            error: {
              message: "Synthetic credential rejected",
              code: "invalid_credential",
            },
          },
        });
      snapshot.eodhd_credential.status =
        body.token === null ? "missing" : "configured";
      return route.fulfill({ json: snapshot.eodhd_credential });
    }
    if (path.includes("/skills/")) {
      const skill = snapshot.skills[0];
      if (!skill) throw new Error("Missing synthetic skill");
      skill.enabled = body.enabled;
      return route.fulfill({ json: { skill } });
    }
    if (path.includes("/toolsets/")) {
      const toolset = snapshot.toolsets[0];
      if (!toolset) throw new Error("Missing synthetic toolset");
      toolset.enabled = body.enabled;
      return route.fulfill({ json: { toolset } });
    }
    return route.fulfill({ status: 404 });
  });
  await page.route("**/api/update-status", (route) =>
    route.fulfill({
      json: {
        status: "ready",
        channel: "preview",
        update_available: true,
        target_version: "synthetic-next",
      },
    }),
  );
  await page.goto("/settings");
  await section(page, "Data sources");
  const sec = page.getByRole("form", { name: "SEC identity" });
  await sec
    .getByRole("textbox")
    .fill("Synthetic Investor investor@example.com");
  await sec.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sec.getByRole("textbox")).toBeEmpty();
  await expect(sec).toContainText("Configured");
  const token = page.getByRole("form", { name: "EODHD token" });
  await token.getByLabel("EODHD token").fill("synthetic-token");
  await token.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.locator('[data-slot="settings-view"]').getByRole("alert"),
  ).toContainText("Synthetic credential rejected");
  await expect(token.getByLabel("EODHD token")).toHaveValue("synthetic-token");
  rejectCredential = false;
  await token.getByRole("button", { name: "Save", exact: true }).click();
  await expect(token.getByLabel("EODHD token")).toBeEmpty();
  await expect(token).toContainText("Configured");
  await token.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(token).toContainText("Not configured");
  await section(page, "Skills and tools");
  await expect(
    page.getByRole("switch", { name: "Required skill", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("switch", { name: "Synthetic skill", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Synthetic skill", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("switch", { name: "Synthetic tools", exact: true })
    .click();
  await expect(
    page.getByRole("switch", { name: "Synthetic tools", exact: true }),
  ).toBeChecked();
  expect(writes).toContainEqual({
    path: "/api/settings/eodhd-token",
    body: { token: null },
  });
  expect(writes).toContainEqual({
    path: "/api/settings/skills/Synthetic%20skill",
    body: { enabled: true },
  });
  expect(writes).toContainEqual({
    path: "/api/settings/toolsets/synthetic-tools",
    body: { enabled: true },
  });
  await section(page, "Updates");
  await expect(
    page
      .locator('[data-slot="settings-view"]')
      .getByRole("tabpanel", { name: "Updates", exact: true }),
  ).toContainText("synthetic-next");
  await expect(
    page
      .locator('[data-slot="settings-view"]')
      .getByRole("tabpanel", { name: "Updates", exact: true }),
  ).toContainText("pythia update");
  expect(state.unexpected).toEqual([]);
});
