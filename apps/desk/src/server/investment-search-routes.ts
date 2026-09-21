import {
  investmentAdoptRequestSchema,
  investmentAdoptResponseSchema,
} from "@pythia/market-data/search";
import { admitBrowserRequest } from "./admission";
import { readPluginRequestBody } from "./plugin-request";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";
import { result, routeError } from "./route-utils";
import { z } from "zod";

const failureSchema = z.object({
  outcome: z.literal("error"),
  issues: z.array(z.object({ code: z.string(), message: z.string() })).min(1),
});

/** Selection is an explicit, narrowly admitted catalogue write, not a general
 * browser mutation bridge. Native enablement and identity checks still apply. */
export function createInvestmentSearchRoutes(
  transport: PluginTransport = createPluginTransport(),
) {
  return {
    async adoptInvestment(request: Request) {
      const denied = admitBrowserRequest(request, "mutation");
      if (denied) return denied;
      try {
        const input = investmentAdoptRequestSchema.safeParse(
          await readPluginRequestBody(request),
        );
        if (!input.success)
          return result(
            { error: { message: "Invalid investment selection." } },
            400,
          );
        const response = JSON.parse(
          await transport(
            {
              plugin: "pythia-market-data",
              operation: "query",
              arguments: { action: "adopt_search", ...input.data },
            },
            request.signal,
          ),
        );
        const failure = failureSchema.safeParse(response);
        if (failure.success)
          return result(
            {
              error: {
                code: failure.data.issues[0]?.code,
                message: failure.data.issues
                  .map((issue) => issue.message)
                  .join(" "),
              },
            },
            422,
          );
        return result(investmentAdoptResponseSchema.parse(response));
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
