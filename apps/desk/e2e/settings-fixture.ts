import type { Page } from "@playwright/test";
import { fixture } from "./stream-fixture";

/*
 * Synthetic Settings data. Device settings follow DeviceSettingsSnapshot;
 * Hermes settings follow the narrowed shapes in
 * src/server/hermes-settings-contract.ts. Every change is recorded and
 * answered here, so no test writes the running Hermes profile.
 */

export const device = {
  model_auth: {
    provider: "openai-codex",
    status: "configured",
    setup_command: "hermes auth login",
  },
  skills_status: "ready",
  skills: [
    {
      name: "Synthetic filing review",
      description: "Compare quarterly reporting changes.",
      enabled: false,
      mutable: true,
      kind: "other-hermes-skill",
    },
    {
      name: "Synthetic macro research",
      description: "Investigate economic series.",
      enabled: true,
      mutable: true,
      kind: "other-hermes-skill",
    },
  ],
  workspace: {
    root: "/synthetic/research",
    native_cwd: "/synthetic/research",
    status: "matched",
  },
  toolsets_status: "ready",
  toolsets: [
    {
      name: "synthetic-browser",
      label: "Synthetic web tools",
      description: "Browse public websites.",
      enabled: true,
      configured: true,
      tools: [],
    },
  ],
};

export const hermesConfig = {
  schema: {
    "display.personality": { type: "select", options: ["", "concise"] },
    "display.show_reasoning": { type: "boolean" },
    "approvals.mode": { type: "string" },
    "approvals.timeout": { type: "number" },
    command_allowlist: { type: "list" },
    model_context_length: { type: "number" },
    "auxiliary.vision.provider": { type: "string" },
    "auxiliary.vision.model": { type: "string" },
  },
  values: {
    "display.show_reasoning": true,
    "approvals.mode": "manual",
    "approvals.timeout": 60,
    command_allowlist: ["ls"],
    model_context_length: 0,
    "auxiliary.vision.provider": "auto",
  },
  model: { provider: "synthetic", model: "synthetic-model" },
};

export const providers = {
  accounts: [
    {
      id: "synthetic-subscription",
      name: "Synthetic Subscription",
      flow: "device_code",
      connected: true,
      source: "Synthetic Portal",
      disconnectable: true,
    },
    {
      id: "synthetic-cli",
      name: "Synthetic CLI",
      flow: "external",
      command: "synthetic login",
      connected: false,
      disconnectable: false,
    },
  ],
  keys: [
    {
      key: "SYNTHETIC_API_KEY",
      label: "Synthetic API key",
      provider: "Synthetic Router",
      advanced: false,
      set: false,
      secret: true,
    },
  ],
};

/** Read-only Hermes settings, for pages that only show them in passing. */
export async function hermesSettings(page: Page) {
  await page.route("**/api/hermes/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/config")) return route.fulfill({ json: hermesConfig });
    if (path.endsWith("/providers")) return route.fulfill({ json: providers });
    return route.fulfill({ json: [] });
  });
}

export type Write = { method: string; path: string; body: unknown };

export async function settingsFixture(page: Page) {
  const state = await fixture(page);
  const writes: Write[] = [];
  let releaseStarts = 0;
  const record = (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const request = route.request();
    if (request.method() === "GET") return false;
    writes.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON(),
    });
    return true;
  };
  await page.route("**/api/settings**", (route) => {
    if (record(route)) return route.fulfill({ json: { status: "configured" } });
    return route.fulfill({ json: device });
  });
  await page.route("**/api/hermes/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    record(route);
    if (path.endsWith("/config")) return route.fulfill({ json: hermesConfig });
    if (path.endsWith("/providers") || path.endsWith("/keys"))
      return route.fulfill({ json: providers });
    if (path.endsWith("/plugins"))
      return route.fulfill({
        json: [
          {
            name: "pythia",
            source: "user",
            active: true,
            locked: "Pythia's research tools live in this plugin.",
          },
          { name: "synthetic-plugin", source: "bundled", active: false },
        ],
      });
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/update-status**", (route) => {
    if (route.request().method() !== "GET") releaseStarts += 1;
    return route.fulfill({
      json: {
        status: "ready",
        channel: "preview",
        current_version: "main",
        current_revision: "a".repeat(40),
        apply_supported: true,
        update_available: false,
      },
    });
  });
  return { ...state, writes, releaseStarts: () => releaseStarts };
}

/** Marks updates as checked today, so a page load makes no daily check. */
export async function checkedToday(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "pythia.updates.checked-at",
      String(Date.now()),
    );
  });
}
