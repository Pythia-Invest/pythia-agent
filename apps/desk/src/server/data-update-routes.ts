import { z } from "zod";
import { admitBrowserRequest } from "./admission";
import { createHermesRequest } from "./hermes";
import { profileFrom } from "./device-settings-native";
import { routeError } from "./route-utils";
import { pluginRequestSchema, readPluginRequestBody } from "./plugin-request";

const bodySchema = z
  .object({
    resources: z
      .array(
        pluginRequestSchema
          .extend({
            window: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();

/** Browser admission and streaming proxy only. Native plugin declarations and
 * operation ownership remain authoritative for permission and payload meaning. */
export function createDataUpdateRoutes(environment = process.env) {
  const upstream = createHermesRequest({
    baseUrl: environment.PYTHIA_HERMES_API_URL ?? "",
    apiKey: environment.API_SERVER_KEY ?? "",
  });
  return {
    async dataUpdates(request: Request) {
      const denied = admitBrowserRequest(request, "mutation");
      if (denied) return denied;
      const abort = new AbortController();
      const signal = AbortSignal.any([request.signal, abort.signal]);
      try {
        const input = await readPluginRequestBody(request);
        const body = bodySchema.safeParse(input);
        if (!body.success)
          return Response.json(
            { error: { message: "Invalid subscription." } },
            { status: 400 },
          );
        const connectionTimeout = setTimeout(() => abort.abort(), 35_000);
        const response = await upstream(
          `/p/${encodeURIComponent(profileFrom(environment))}/v1/pythia/updates`,
          {
            method: "POST",
            body: JSON.stringify(body.data),
            signal,
            headers: { Accept: "text/event-stream" },
          },
        ).finally(() => clearTimeout(connectionTimeout));
        if (
          !response.body ||
          !response.headers.get("content-type")?.startsWith("text/event-stream")
        )
          throw Error("Invalid update transport.");
        // StreamResponse already bounds frames and slow consumers. No collection,
        // Next response cache, or whole-response timeout on this long-lived path.
        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
          },
        });
      } catch (error) {
        abort.abort();
        return routeError(error);
      }
    },
  };
}
