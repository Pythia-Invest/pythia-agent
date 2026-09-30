import { admitBrowserRequest } from "./admission";
import { HermesApiError } from "./hermes-records";
import {
  type HermesSettingsService,
  hermesSettingsService,
} from "./hermes-settings";
import { identifier, readBody, result, routeError } from "./route-utils";

type RouteContext = { params: Promise<Record<string, string>> };
type Kind = "read" | "mutation";

function booleanField(body: Record<string, unknown>, field: string) {
  if (typeof body[field] !== "boolean")
    throw new HermesApiError(`${field} must be true or false.`, 400);
  return body[field];
}

/**
 * Browser routes for Hermes settings. Every one is admitted like Desk's other
 * settings routes; the service narrows what Hermes returns and accepts.
 */
export function createHermesSettingsRoutes(
  settings: HermesSettingsService = hermesSettingsService,
) {
  const route =
    (
      kind: Kind,
      run: (
        request: Request,
        params: Record<string, string>,
      ) => Promise<unknown>,
    ) =>
    // Next always passes the route context; its params are empty on routes
    // without dynamic segments.
    async (request: Request, context: RouteContext) => {
      const rejection = admitBrowserRequest(request, kind);
      if (rejection) return rejection;
      try {
        return result(await run(request, await context.params));
      } catch (error) {
        return routeError(error);
      }
    };
  const body = (request: Request) => readBody(request);

  return {
    hermesConfig: route("read", () => settings.config()),
    saveHermesConfig: route("mutation", async (request) =>
      settings.saveConfig(await body(request)),
    ),
    hermesProviders: route("read", () => settings.providers()),
    setProviderKey: route("mutation", async (request) =>
      settings.setKey(await body(request)),
    ),
    providerAccount: route("mutation", async (request, params) => {
      const id = identifier(params.id, "provider");
      const { action } = await body(request);
      if (action === "sign-in") return settings.startSignIn(id);
      if (action === "disconnect") return settings.disconnect(id);
      throw new HermesApiError("Choose sign-in or disconnect.", 400);
    }),
    providerSignIn: route("read", async (_request, params) =>
      settings.signInStatus(
        identifier(params.id, "provider"),
        identifier(params.session, "sign-in session"),
      ),
    ),
    cancelProviderSignIn: route("mutation", async (request, params) => {
      await body(request);
      return settings.cancelSignIn(
        identifier(params.session, "sign-in session"),
      );
    }),
    setMainModel: route("mutation", async (request) =>
      settings.setModel(await body(request)),
    ),
    customEndpoints: route("read", () => settings.endpoints()),
    saveCustomEndpoint: route("mutation", async (request) =>
      settings.saveEndpoint(await body(request)),
    ),
    customEndpointAction: route("mutation", async (request, params) =>
      settings.endpointAction(
        identifier(params.id, "endpoint"),
        await body(request),
      ),
    ),
    mcpServers: route("read", () => settings.mcp()),
    setMcpServer: route("mutation", async (request, params) =>
      settings.setMcpEnabled(
        identifier(params.name, "server name"),
        booleanField(await body(request), "enabled"),
      ),
    ),
    agentPlugins: route("read", () => settings.plugins()),
    setAgentPlugin: route("mutation", async (request, params) =>
      settings.setPluginEnabled(
        identifier(params.name, "plugin name"),
        booleanField(await body(request), "enabled"),
      ),
    ),
  };
}
