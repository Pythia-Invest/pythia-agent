"use client";
import {
  marketQueryKey,
  type MoverList,
  readMarketMovers,
  readMarketOverview,
} from "@pythia/market-data/markets";
import {
  readSubject,
  SUBJECT_STALE_MS,
  subjectQueryKey,
} from "@pythia/market-data/subject";
import { useQueries, useQuery } from "@tanstack/react-query";
import { busyRetry } from "./busy-retry";
import { useDeskApi } from "./providers";

/** A list refreshes while the page is visible; the source caches for a minute. */
const MOVERS_REFRESH_MS = 60_000;

/** The overview's card and watchlist subjects: a local core read of settings. */
export function useMarketOverview() {
  const api = useDeskApi();
  return useQuery({
    queryKey: marketQueryKey("market-overview"),
    queryFn: ({ signal }) =>
      readMarketOverview(
        { read: (request) => api.pluginRead(request, signal) },
        signal,
      ),
    staleTime: SUBJECT_STALE_MS,
    ...busyRetry,
  });
}

/** One market movers list from the investor's chosen source. */
export function useMarketMovers(list: MoverList, limit: number) {
  const api = useDeskApi();
  return useQuery({
    queryKey: marketQueryKey("market-movers", list, limit),
    queryFn: ({ signal }) =>
      readMarketMovers(
        { read: (request) => api.pluginRead(request, signal) },
        list,
        limit,
        signal,
      ),
    staleTime: MOVERS_REFRESH_MS,
    refetchInterval: MOVERS_REFRESH_MS,
    ...busyRetry,
  });
}

/** Several subjects' page compositions under the instrument page's own key,
 * so a card or row opens its page on cached data. */
export function useSubjectPages(subjectIds: readonly string[]) {
  const api = useDeskApi();
  return useQueries({
    queries: subjectIds.map((subjectId) => ({
      queryKey: subjectQueryKey(subjectId),
      queryFn: () =>
        readSubject({ read: (request) => api.pluginRead(request) }, subjectId),
      staleTime: SUBJECT_STALE_MS,
      ...busyRetry,
    })),
  });
}
