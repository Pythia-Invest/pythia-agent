import { readPluginRequestBody } from "./plugin-request";
import { admitBrowserRequest } from "./admission";
import { financialDataService } from "./financial-data";
import { result, routeError } from "./route-utils";
import { financialRequestSchema } from "@pythia/market-data/widgets/contract";
export function createFinancialDataRoutes(service = financialDataService) {
  return {
    async financialRead(request: Request) {
      const rejected = admitBrowserRequest(request, "mutation");
      if (rejected) return rejected;
      try {
        const parsed = financialRequestSchema.safeParse(
          await readPluginRequestBody(request),
        );
        if (!parsed.success)
          return result(
            { error: { message: "Invalid financial read request." } },
            400,
          );
        return result(await service.read(parsed.data, request.signal));
      } catch (error) {
        return routeError(error);
      }
    },
    async financialPreferences(request: Request) {
      const rejected = admitBrowserRequest(request, "read");
      if (rejected) return rejected;
      try {
        return result(await service.preferences(request.signal));
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
