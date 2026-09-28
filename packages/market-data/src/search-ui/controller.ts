"use client";
import { type PluginTransport, useQueries, useQuery } from "@pythia/widget-sdk";
import { useCallback } from "react";
import { z } from "zod";
import {
  type LookupRequest,
  type SearchRequest,
  type SearchResponse,
  type SearchGroup,
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

/** All listings of the given groups, one cached group read per group, keyed
 * by group id once read; `pending` names the groups still loading or failed. */
export function useGroupListings(
  search: SearchBackend,
  query: string,
  filter: TypeFilter,
  groups: readonly SearchGroup[],
) {
  const kinds = TYPE_FILTERS.find((type) => type.value === filter)?.kinds;
  const ids = groups.map((group) => group.id).join("\n");
  // A stable combine keeps the answer's identity while no read changes, so
  // the panel's options are not rebuilt on every render.
  const combine = useCallback(
    (results: { data?: SearchResponse | undefined; isPending: boolean }[]) => {
      const rows = new Map<string, readonly SearchRow[]>();
      const pending = new Map<string, "loading" | "error">();
      ids.split("\n").forEach((id, index) => {
        const result = results[index];
        if (!id || !result) return;
        const read = result.data?.groups.find((group) => group.id === id);
        if (read) rows.set(id, read.rows);
        else pending.set(id, result.isPending ? "loading" : "error");
      });
      return { rows, pending };
    },
    [ids],
  );
  return useQueries({
    queries: groups.map((group) => ({
      queryKey: [...searchQueryKey, "group", group.id, filter],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        search({ query, group: group.id, ...(kinds ? { kinds } : {}) }, signal),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    })),
    combine,
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
