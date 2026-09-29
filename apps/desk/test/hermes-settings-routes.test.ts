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
});
