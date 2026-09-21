"use client";
import { useQuery } from "@tanstack/react-query";
import type { PluginRequest } from "./data-protocol";

export type PluginWidgetSource = PluginRequest & {
  delivery?: "snapshot" | "updates";
};
import { useDataQueries } from "./data-queries";
import { useDeskApi } from "./providers";

/** One-shot reads are the default. Streaming is explicit and uses the same
 * operation; unsupported updates remain a visible native declaration error. */
export function usePluginWidgetData(
  source: PluginWidgetSource,
  enabled: boolean,
) {
  const api = useDeskApi();
  const resource = {
    plugin: source.plugin,
    operation: source.operation,
    arguments: source.arguments,
  };
  const streaming = source.delivery === "updates";
  const key = ["plugin-widget", streaming ? "updates" : "snapshot", resource];
  const snapshot = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.pluginRead(resource, signal),
    enabled: enabled && !streaming,
    // New demand must revalidate native authority, even when this query retains
    // a previous snapshot. Identical active consumers still share one fetch.
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    refetchOnWindowFocus: false,
  });
  const updates = useDataQueries<unknown>(
    streaming
      ? [
          {
            key,
            resource,
            enabled,
            decode: (value) => value,
            // Explicit refresh follows the declared update channel, without falling
            // back to snapshot reads for an unsupported update declaration.
          },
        ]
      : [],
  );
  // An offline/paused validation is still outstanding and cannot publish cache.
  const checking = !enabled || snapshot.fetchStatus !== "idle";
  const checkedSnapshot = {
    ...snapshot,
    data: checking || snapshot.isError ? undefined : snapshot.data,
    error: checking ? null : snapshot.error,
    isSuccess: !checking && snapshot.isSuccess,
    isPending: checking || snapshot.isPending,
    status: checking ? ("pending" as const) : snapshot.status,
  };
  const result = streaming ? updates[0] : checkedSnapshot;
  if (!result) throw Error("Missing plugin data query.");
  return result;
}
