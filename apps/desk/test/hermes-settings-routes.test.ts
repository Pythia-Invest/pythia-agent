import { describe, expect, it, vi } from "vitest";
import { browserAdmissionNames } from "@/server/admission";
import { HermesApiError } from "@/server/hermes-records";
import type { HermesSettingsService } from "@/server/hermes-settings";
import { createHermesSettingsRoutes } from "@/server/hermes-settings-routes";

const origin = "http://127.0.0.1:43121";
const token = "T".repeat(43);
const none = { params: Promise.resolve({}) };

function service() {
  return {
    config: vi.fn(async () => ({ schema: {}, values: {}, model: {} })),
    saveConfig: vi.fn(async () => ({ schema: {}, values: {}, model: {} })),
    setKey: vi.fn(async () => ({})),
    setPluginEnabled: vi.fn(async () => []),
  } as unknown as HermesSettingsService & {
    saveConfig: ReturnType<typeof vi.fn>;
    setKey: ReturnType<typeof vi.fn>;
    setPluginEnabled: ReturnType<typeof vi.fn>;
  };
}

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> },
) {
  return new Request(`${origin}${path}`, {
    method: init.method ?? "GET",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      host: "127.0.0.1:43121",
      origin,
      "content-type": "application/json",
      cookie: `${browserAdmissionNames.sessionCookie}=${token}`,
      [browserAdmissionNames.csrfHeader]: token,
      ...init.headers,
    },
  });
}

describe("Hermes settings routes", () => {
  it("admits a change before reading it: CSRF, origin and JSON are required", async () => {
    const settings = service();
    const routes = createHermesSettingsRoutes(settings);
    const change = { values: { timezone: "UTC" } };
    const missingCsrf = await routes.saveHermesConfig(
      request("/api/hermes/config", {
        method: "PATCH",
        body: change,
        headers: { [browserAdmissionNames.csrfHeader]: "" },
      }),
      none,
    );
    expect(missingCsrf.status).toBe(403);
    const elsewhere = await routes.saveHermesConfig(
      request("/api/hermes/config", {
        method: "PATCH",
        body: change,
        headers: { origin: "https://elsewhere.test" },
      }),
      none,
    );
    expect(elsewhere.status).toBe(403);
    const plainText = await routes.setProviderKey(
      request("/api/hermes/keys", {
        method: "POST",
        body: { key: "OPENROUTER_API_KEY", value: "x" },
        headers: { "content-type": "text/plain" },
      }),
      none,
    );
    expect(plainText.status).toBeGreaterThanOrEqual(400);
    expect(settings.saveConfig).not.toHaveBeenCalled();
    expect(settings.setKey).not.toHaveBeenCalled();
    const accepted = await routes.saveHermesConfig(
      request("/api/hermes/config", { method: "PATCH", body: change }),
      none,
    );
    expect(accepted.status).toBe(200);
    expect(settings.saveConfig).toHaveBeenCalledWith(change);
  });

  it("passes a named plugin through to the service, which decides", async () => {
    const settings = service();
    settings.setPluginEnabled.mockRejectedValueOnce(
      new HermesApiError("That name isn't valid.", 400),
    );
    const response = await createHermesSettingsRoutes(settings).setAgentPlugin(
      request("/api/hermes/plugins/pythia%2F", {
        method: "POST",
        body: { enabled: false },
      }),
      { params: Promise.resolve({ name: "pythia/" }) },
    );
    expect(response.status).toBe(400);
    expect(settings.setPluginEnabled).toHaveBeenCalledWith("pythia/", false);
  });
});
