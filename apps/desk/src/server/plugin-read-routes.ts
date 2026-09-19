import { admitBrowserRequest } from "./admission";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";
import { pluginRequestSchema, readPluginRequestBody } from "./plugin-request";
import { result, routeError } from "./route-utils";

/** Native declarations own eligibility and semantics. This browser route adds
 * admission and bounds, never arbitrary tool dispatch or result translation. */
export function createPluginReadRoutes(
  transport: PluginTransport = createPluginTransport(),
) {
  return {
    async pluginRead(request: Request) {
      const denied = admitBrowserRequest(request, "mutation");
      if (denied) return denied;
      try {
        const input = pluginRequestSchema.safeParse(
          await readPluginRequestBody(request),
        );
        if (!input.success)
          return result({ error: { message: "Invalid plugin request." } }, 400);
        return result(
          JSON.parse(
            await transport({ ...input.data, readOnly: true }, request.signal),
          ),
        );
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
