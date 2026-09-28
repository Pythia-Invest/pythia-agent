"use client";
import {
  type PluginTransport,
  useQuery,
  useQueryClient,
} from "@pythia/widget-sdk";
import { useMemo } from "react";
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

type GroupRead = { id: string; rows: readonly SearchRow[] | null };

/** All listings of the given groups, each its own cached group read, keyed by
 * group id once read; `pending` names the groups still loading or failed. */
export function useGroupListings(
  search: SearchBackend,
  query: string,
  filter: TypeFilter,
  groups: readonly SearchGroup[],
) {
  const client = useQueryClient();
  const kinds = TYPE_FILTERS.find((type) => type.value === filter)?.kinds;
  const ids = groups.map((group) => group.id);
  const reads = useQuery<GroupRead[]>({
    queryKey: [...searchQueryKey, "groups", ids, filter],
    queryFn: ({ signal }) =>
      Promise.all(
        ids.map((id) =>
          client
            .fetchQuery({
              queryKey: [...searchQueryKey, "group", id, filter],
              queryFn: () =>
                search(
                  { query, group: id, limit: 1, ...(kinds ? { kinds } : {}) },
                  signal,
                ),
              staleTime: 30_000,
              gcTime: 5 * 60_000,
            })
            .then(
              (response) => ({
                id,
                rows:
                  response.groups.find((group) => group.id === id)?.rows ??
                  null,
              }),
              () => ({ id, rows: null }),
            ),
        ),
      ),
    enabled: ids.length > 0,
    // Groups already read stay shown while another group's read runs.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const key = ids.join("\n");
  return useMemo(() => {
    const done = new Map(reads.data?.map((read) => [read.id, read.rows]));
    const rows = new Map<string, readonly SearchRow[]>();
    const pending = new Map<string, "loading" | "error">();
    for (const id of key ? key.split("\n") : []) {
      const read = done.get(id);
      if (read) rows.set(id, read);
      else pending.set(id, read === null ? "error" : "loading");
    }
    return { rows, pending };
  }, [reads.data, key]);
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
