import { describe, expect, it, vi } from "vitest";
import type { HermesSettingsService } from "@/server/hermes-settings";
import { createHermesSettingsRoutes } from "@/server/hermes-settings-routes";

const origin = "http://127.0.0.1:43121";
const token = "T".repeat(43);
const none = { params: Promise.resolve({}) };

function request(path: string, body: unknown, csrf = token) {
  return new Request(`${origin}${path}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: {
      host: "127.0.0.1:43121",
      origin,
      "content-type": "application/json",
      cookie: `pythia_desk_session=${token}`,
      "x-pythia-csrf": csrf,
    },
  });
}

describe("Hermes settings routes", () => {
  it("admits a change before handing it to the settings service", async () => {
    const saveConfig = vi.fn(async () => ({
      schema: {},
      values: {},
      model: {},
    }));
    const routes = createHermesSettingsRoutes({
      saveConfig,
    } as unknown as HermesSettingsService);
    const change = { values: { timezone: "UTC" } };
    const missingCsrf = await routes.saveHermesConfig(
      request("/api/hermes/config", change, ""),
      none,
    );
    expect(missingCsrf.status).toBe(403);
    expect(saveConfig).not.toHaveBeenCalled();
    const accepted = await routes.saveHermesConfig(
      request("/api/hermes/config", change),
      none,
    );
    expect(accepted.status).toBe(200);
    expect(saveConfig).toHaveBeenCalledWith(change);
  });

  it("refuses a provider key sent as a simple cross-site form body", async () => {
    const setKey = vi.fn();
    const routes = createHermesSettingsRoutes({
      setKey,
    } as unknown as HermesSettingsService);
    const plain = request("/api/hermes/keys", {
      key: "OPENROUTER_API_KEY",
      value: "x",
    });
    plain.headers.set("content-type", "text/plain");
    const response = await routes.setProviderKey(plain, none);
    expect(response.status).toBe(415);
    expect(setKey).not.toHaveBeenCalled();
  });

  it("passes a plugin's name and requested state to the service", async () => {
    const setPluginEnabled = vi.fn(async () => []);
    const routes = createHermesSettingsRoutes({
      setPluginEnabled,
    } as unknown as HermesSettingsService);
    const response = await routes.setAgentPlugin(
      request("/api/hermes/plugins/research", { enabled: false }),
      { params: Promise.resolve({ name: "research" }) },
    );
    expect(response.status).toBe(200);
    expect(setPluginEnabled).toHaveBeenCalledWith("research", false);
  });
});
