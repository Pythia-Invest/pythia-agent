import { expect, type Page, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

async function section(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) < 640) {
    await page.getByRole("combobox", { name: "Settings section" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  } else await page.getByRole("tab", { name, exact: true }).click();
}

test("native model readiness and capability toggles use the existing API", async ({
  page,
}) => {
  const state = await fixture(page);
  const snapshot = {
    model_auth: {
      provider: "openai-codex",
      status: "missing",
      setup_command: "hermes auth login",
    },
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
    workspace: { root: null, native_cwd: null, status: "unavailable" as const },
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
  await page.route("**/api/settings**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET") return route.fulfill({ json: snapshot });
    const body = request.postDataJSON();
    writes.push({ path, body });
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
  await section(page, "Models");
  const modelSettings = page.getByRole("tabpanel", {
    name: "Models",
    exact: true,
  });
  await expect(modelSettings).toContainText("Codex authentication");
  await expect(modelSettings).toContainText("Not configured");
  await expect(modelSettings).toContainText(snapshot.model_auth.setup_command);
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
