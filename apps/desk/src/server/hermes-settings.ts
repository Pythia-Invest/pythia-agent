import { capabilityMutationLock } from "./device-settings";
import { defaultRestart, withFileLock } from "./device-settings-native";
import { HermesApiError } from "./hermes-records";
import type {
  AccountSignIn,
  AccountSignInStatus,
  ModelAssignment,
} from "./hermes-settings-contract";
import {
  accounts,
  agentPlugins,
  configPatch,
  configView,
  customEndpoints,
  mcpServers,
  providerKeyChange,
  providerKeys,
  PYTHIA_PLUGIN,
} from "./hermes-settings-shape";

/*
 * Hermes's own settings server (`hermes serve`, the backend Hermes Desktop
 * uses), scoped to Pythia's profile on loopback. Only Desk's server holds its
 * token; the browser reaches it through the routes in
 * hermes-settings-routes.ts, which pass nothing the shape functions drop.
 */

type Json = Record<string, unknown>;
type Method = "GET" | "PUT" | "POST" | "DELETE";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

function transport(environment: NodeJS.ProcessEnv, fetcher: typeof fetch) {
  return async function call<T = unknown>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = environment.PYTHIA_HERMES_SETTINGS_URL;
    const token = environment.PYTHIA_HERMES_SETTINGS_TOKEN;
    if (!url || !token)
      throw new HermesApiError(
        "Hermes settings aren't available: this device isn't running Pythia's settings service.",
        503,
        "settings_unavailable",
      );
    const base = new URL(url);
    if (base.protocol !== "http:" || !LOOPBACK.has(base.hostname))
      throw new HermesApiError(
        "Pythia's settings service must be on this device.",
        503,
        "settings_unavailable",
      );
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HermesApiError(
        "Pythia couldn't reach Hermes's settings service. It may still be starting.",
        503,
        "settings_unreachable",
      );
    }
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const detail =
        json && typeof json === "object" && "detail" in json
          ? (json as { detail?: unknown }).detail
          : undefined;
      // A refusal explains itself; a server failure's detail can carry
      // internal paths or traces, so it stays on the host.
      throw new HermesApiError(
        response.status < 500 && typeof detail === "string" && detail.trim()
          ? detail.trim().slice(0, 300)
          : `Hermes's settings service answered ${response.status}.`,
        response.status >= 500 ? 502 : response.status,
        "hermes_settings_error",
      );
    }
    return json as T;
  };
}

/**
 * One path segment of a settings-server URL. A name that could be read as a
 * path of its own is refused, not encoded: Hermes and its server decode
 * `%2F` and strip slashes, so an encoded name could reach another resource
 * (`pythia%2F` names Pythia's plugin, `..` its parent).
 */
function segment(value: string) {
  if (/[/\\%]/u.test(value) || value === "." || value === "..")
    throw new HermesApiError("That name isn't valid.", 400);
  return encodeURIComponent(value);
}
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

function required(value: unknown, label: string, maximum = 256) {
  const clean = text(value);
  if (!clean || clean.length > maximum || /[\r\n\0]/u.test(clean))
    throw new HermesApiError(`A valid ${label} is required.`, 400);
  return clean;
}

export function createHermesSettings(
  environment: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
  capability: {
    restartHermes?: () => Promise<void>;
    lockPath?: string;
  } = {},
) {
  const call = transport(environment, fetcher);
  // Plugins and MCP servers are loaded by Pythia's chat server when it starts,
  // so switching one takes the device's capability lock and restarts it, as
  // skills and toolsets do.
  const restartHermes = capability.restartHermes ?? defaultRestart(environment);
  const changeCapability = (write: () => Promise<unknown>) =>
    withFileLock(
      capability.lockPath ?? capabilityMutationLock(environment),
      async () => {
        await write();
        await restartHermes();
      },
    );

  const service = {
    async config() {
      const [schema, config] = await Promise.all([
        call("GET", "/api/config/schema"),
        call("GET", "/api/config"),
      ]);
      return configView(schema, config);
    },
    async saveConfig(body: Json) {
      // Hermes's schema checks types; its current config restores list
      // secrets the browser never saw.
      const [schema, current] = await Promise.all([
        call("GET", "/api/config/schema"),
        call("GET", "/api/config"),
      ]);
      await call("PUT", "/api/config", {
        config: configPatch(body, schema, current),
      });
      return service.config();
    },
    async providers() {
      const [oauth, env] = await Promise.all([
        call("GET", "/api/providers/oauth"),
        call("GET", "/api/env"),
      ]);
      return { accounts: accounts(oauth), keys: providerKeys(env) };
    },
    async setKey(body: Json) {
      const change = providerKeyChange(
        body,
        providerKeys(await call("GET", "/api/env")),
      );
      if (change.value === null)
        await call("DELETE", "/api/env", { key: change.key });
      else await call("PUT", "/api/env", change);
      return service.providers();
    },
    async startSignIn(id: string): Promise<AccountSignIn> {
      const account = accounts(await call("GET", "/api/providers/oauth")).find(
        (item) => item.id === id,
      );
      if (account?.flow !== "device_code")
        throw new HermesApiError(
          "This provider signs in with a command on the device.",
          400,
        );
      const started = await call<Json>(
        "POST",
        `/api/providers/oauth/${segment(id)}/start`,
        {},
      );
      const verificationUrl = text(started?.verification_url);
      if (!/^https:\/\//iu.test(verificationUrl))
        throw new HermesApiError(
          "Hermes didn't return a sign-in page for this provider.",
          502,
        );
      return {
        sessionId: required(started.session_id, "sign-in session"),
        userCode: text(started.user_code),
        verificationUrl,
        expiresIn: Number(started.expires_in) || 900,
      };
    },
    async signInStatus(
      id: string,
      sessionId: string,
    ): Promise<AccountSignInStatus> {
      const status = await call<Json>(
        "GET",
        `/api/providers/oauth/${segment(id)}/poll/${segment(sessionId)}`,
      );
      const message = text(status?.error_message);
      return {
        status: text(status?.status) || "pending",
        ...(message ? { message: message.slice(0, 300) } : {}),
      };
    },
    async cancelSignIn(sessionId: string) {
      await call(
        "DELETE",
        `/api/providers/oauth/sessions/${segment(sessionId)}`,
      );
      return { cancelled: true };
    },
    async disconnect(id: string) {
      await call("DELETE", `/api/providers/oauth/${segment(id)}`);
      return service.providers();
    },
    async setModel(body: Json): Promise<ModelAssignment> {
      const result = await call<Json>("POST", "/api/model/set", {
        scope: "main",
        provider: required(body.provider, "provider"),
        model: required(body.model, "model", 512),
        confirm_expensive_model: body.confirm === true,
      });
      const confirm = text(result?.confirm_message);
      if (result?.confirm_required === true)
        return { ok: false, confirm: confirm || "Use this model?" };
      return { ok: result?.ok !== false };
    },
    async endpoints() {
      return customEndpoints(
        await call("GET", "/api/providers/custom-endpoints"),
      );
    },
    async saveEndpoint(body: Json) {
      const baseUrl = required(body.baseUrl, "endpoint URL", 2_048);
      if (!/^https?:\/\//iu.test(baseUrl))
        throw new HermesApiError("The endpoint URL must start with http.", 400);
      const apiKey = text(body.apiKey);
      await call("POST", "/api/providers/custom-endpoints", {
        name: required(body.name, "name"),
        base_url: baseUrl,
        model: required(body.model, "model", 512),
        ...(apiKey ? { api_key: apiKey } : {}),
        make_default: body.makeDefault === true,
      });
      return service.endpoints();
    },
    async endpointAction(id: string, body: Json) {
      if (body.action === "activate")
        await call(
          "POST",
          `/api/providers/custom-endpoints/${segment(id)}/activate`,
          {},
        );
      else if (body.action === "remove")
        await call("DELETE", `/api/providers/custom-endpoints/${segment(id)}`);
      else throw new HermesApiError("Choose activate or remove.", 400);
      return service.endpoints();
    },
    async mcp() {
      return mcpServers(await call("GET", "/api/mcp/servers"));
    },
    async setMcpEnabled(name: string, enabled: boolean) {
      const path = `/api/mcp/servers/${segment(name)}/enabled`;
      await changeCapability(() => call("PUT", path, { enabled }));
      return service.mcp();
    },
    async plugins() {
      return agentPlugins(await call("GET", "/api/dashboard/plugins/hub"));
    },
    async setPluginEnabled(name: string, enabled: boolean) {
      if (name === PYTHIA_PLUGIN)
        throw new HermesApiError("Pythia's own plugin stays on.", 400);
      // Only a plugin Hermes lists, by its exact name, can be switched.
      const listed = await service.plugins();
      const plugin = listed.find((item) => item.name === name);
      if (!plugin)
        throw new HermesApiError("There's no plugin with that name.", 404);
      if (plugin.locked)
        throw new HermesApiError("Pythia's own plugin stays on.", 400);
      const path = `/api/dashboard/agent-plugins/${segment(name)}/${enabled ? "enable" : "disable"}`;
      await changeCapability(() => call("POST", path, {}));
      return service.plugins();
    },
  };
  return service;
}

export type HermesSettingsService = ReturnType<typeof createHermesSettings>;

export const hermesSettingsService = createHermesSettings();
