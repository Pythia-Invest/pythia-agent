import { admitBrowserRequest } from "./admission";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";
import { pluginRequestSchema, readPluginRequestBody } from "./plugin-request";
import { result, routeError } from "./route-utils";

/** Native declarations own eligibility and semantics. These browser routes add
 * admission and bounds, never arbitrary tool dispatch or result translation. */
function pluginRoute(transport: PluginTransport, readOnly: boolean) {
  return async (request: Request) => {
    const denied = admitBrowserRequest(request, "mutation");
    if (denied) return denied;
    try {
      const input = pluginRequestSchema.safeParse(
        await readPluginRequestBody(request),
      );
      if (!input.success)
        return result({ error: { message: "Invalid plugin request." } }, 400);
      const call = readOnly ? { ...input.data, readOnly } : input.data;
      return result(JSON.parse(await transport(call, request.signal)));
    } catch (error) {
      return routeError(error);
    }
  };
}

export function createPluginReadRoutes(
  transport: PluginTransport = createPluginTransport(),
) {
  return { pluginRead: pluginRoute(transport, true) };
}

/** Explicit user actions may call deliberate native operation exports. Native
 * ownership, enablement and argument checks are identical to automatic reads. */
export function createPluginInvokeRoutes(
  transport: PluginTransport = createPluginTransport(),
) {
  return { pluginInvoke: pluginRoute(transport, false) };
}
