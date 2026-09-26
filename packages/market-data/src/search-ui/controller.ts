"use client";
import { type PluginTransport, useQuery } from "@pythia/widget-sdk";
import { z } from "zod";
import {
  type LookupRequest,
  type SearchGroup,
  type SearchRequest,
  type SearchResponse,
  searchResponseSchema,
} from "../search";
import { TYPE_FILTERS, type TypeFilter } from "./search-model";

export const SEARCH_PLUGIN = "pythia-market-data";
/** Feature cache keys start with the native plugin id so Desk can withdraw
 * retained results when the feature's access changes (ADR 0036). */
export const searchQueryKey = ["plugin", SEARCH_PLUGIN, "search"] as const;
export const SEARCH_LIMIT = 20;

/** Reads the local directory. Implementations must honour cancellation. */
export type SearchBackend = (
  request: SearchRequest,
  signal: AbortSignal,
) => Promise<SearchResponse>;

/** Runs one explicit lookup in one plugin. */
export type LookupRunner = (
  request: LookupRequest,
  signal: AbortSignal,
) => Promise<SearchGroup[]>;

/** Directory groups for the typed query. The previous answer stays on screen
 * while the next one loads, and a reopened panel answers from the cache. */
export function useDirectorySearch(
  search: SearchBackend,
  query: string,
  filter: TypeFilter,
  enabled: boolean,
) {
  const kinds = TYPE_FILTERS.find((type) => type.value === filter)?.kinds;
  return useQuery<SearchResponse>({
    queryKey: [...searchQueryKey, query, filter],
    queryFn: ({ signal }) =>
      search(
        { query, limit: SEARCH_LIMIT, ...(kinds ? { kinds } : {}) },
        signal,
      ),
    enabled: enabled && query.length > 0,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

const envelopeSchema = z.object({
  outcome: z.enum(["ok", "empty", "partial", "error"]),
  data: z.unknown().optional(),
});

/** Provisional read-only binding of the core directory search until the
 * directory-search backend defines its export. It never names the feature's
 * provider `search` action, so no connector is reached from the typing path;
 * until the export exists the panel shows its unavailable state. */
export function transportSearch(transport: PluginTransport): SearchBackend {
  return async (request, signal) => {
    const envelope = envelopeSchema.parse(
      await transport.read(
        {
          plugin: SEARCH_PLUGIN,
          operation: "query",
          arguments: { action: "directory_search", ...request },
        },
        signal,
      ),
    );
    if (envelope.outcome === "error")
      throw Error("Investment search is unavailable.");
    return searchResponseSchema.parse(envelope.data);
  };
}
