import { admitBrowserRequest } from "./admission";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";
import { pluginRequestSchema, readPluginRequestBody } from "./plugin-request";
import { result, routeError } from "./route-utils";

/** Explicit user actions may call deliberate native operation exports. Native
 * ownership, enablement and argument checks are identical to automatic reads. */
export function createPluginInvokeRoutes(
  transport: PluginTransport = createPluginTransport(),
) {
  return {
    async pluginInvoke(request: Request) {
      const denied = admitBrowserRequest(request, "mutation");
      if (denied) return denied;
      try {
        const input = pluginRequestSchema.safeParse(
          await readPluginRequestBody(request),
        );
        if (!input.success)
          return result({ error: { message: "Invalid plugin request." } }, 400);
        return result(JSON.parse(await transport(input.data, request.signal)));
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
