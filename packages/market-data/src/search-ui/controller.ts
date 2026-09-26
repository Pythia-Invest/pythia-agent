"use client";
import { type PluginTransport, useQuery } from "@pythia/widget-sdk";
import { z } from "zod";
import {
  type LookupRequest,
  type SearchRequest,
  type SearchResponse,
  type SearchRow,
  searchResponseSchema,
} from "../search";
import { TYPE_FILTERS, type TypeFilter } from "./search-model";

/** Core serves the local directory search. */
export const SEARCH_PLUGIN = "pythia";
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
) => Promise<SearchRow[]>;

/** Directory rows for the typed query. The previous answer stays on screen
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

/** Read-only binding of the core directory search (`pythia`/`identity-search`).
 * It never names a provider `search` action, so no connector is reached from
 * the typing path; a denied or missing export shows the unavailable state. */
export function transportSearch(transport: PluginTransport): SearchBackend {
  return async (request, signal) => {
    const envelope = envelopeSchema.parse(
      await transport.read(
        {
          plugin: SEARCH_PLUGIN,
          operation: "identity-search",
          arguments: { ...request },
        },
        signal,
      ),
    );
    if (envelope.outcome === "error")
      throw Error("Investment search is unavailable.");
    return searchResponseSchema.parse(envelope.data);
  };
}
