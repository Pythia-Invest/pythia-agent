import { admitBrowserRequest } from "./admission";
import {
  type PluginConfigurationService,
  pluginConfigurationService,
} from "./plugin-configuration";
import { failure } from "./plugin-configuration-contract";
import { readBody, result, routeError } from "./route-utils";

function requestText(body: Record<string, unknown>, field: string) {
  const value = body[field];
  if (typeof value !== "string" || !value || value.length > 129)
    throw failure(`${field} is required.`);
  return value;
}

export function createPluginConfigurationRoutes(
  configuration: PluginConfigurationService = pluginConfigurationService,
) {
  return {
    async pluginConfiguration(request: Request) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        return result(await configuration.list(request.signal));
      } catch (error) {
        return routeError(error);
      }
    },
    async setPluginConfiguration(request: Request) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const body = await readBody(request);
        const value = body.value;
        if (
          Object.keys(body).some(
            (field) => !["plugin", "key", "value"].includes(field),
          ) ||
          (value !== null &&
            (typeof value !== "string" || !value.trim() || value.length > 1024))
        )
          throw failure("Send a non-empty value, or null to remove it.");
        return result({
          plugin: await configuration.set(
            requestText(body, "plugin"),
            requestText(body, "key"),
            value,
            request.signal,
          ),
        });
      } catch (error) {
        return routeError(error);
      }
    },
    async checkPluginConfiguration(request: Request) {
      const rejection = admitBrowserRequest(request, "mutation");
      if (rejection) return rejection;
      try {
        const body = await readBody(request);
        return result({
          plugin: await configuration.check(
            requestText(body, "plugin"),
            request.signal,
          ),
        });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
