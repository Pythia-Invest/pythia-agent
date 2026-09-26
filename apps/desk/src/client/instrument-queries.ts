"use client";
import {
  readSubject,
  resolveSections,
  SUBJECT_PLUGIN,
  SUBJECT_STALE_MS,
  type SubjectSection,
  subjectQueryKey,
} from "@pythia/market-data/subject";
import { useQueries, useQuery } from "@tanstack/react-query";
import { busyRetry } from "./busy-retry";
import type { PluginRequest } from "./data-protocol";
import { useDeskApi } from "./providers";

/*
 * Page reads deliberately take no abort signal: an unmount (a remount in
 * development, a quick back-and-forth) then leaves the one request running and
 * the next mount joins it, instead of aborting it and issuing an identical
 * read that native admission refuses while the cancelled copy finishes.
 * These are small local reads; an unneeded answer only fills the cache.
 */

/** One subject's page composition: a fast local core read. The search bar
 * prefetches the same key while the user highlights a row. */
export function useSubjectPage(subjectId: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: subjectQueryKey(subjectId),
    queryFn: () =>
      readSubject({ read: (request) => api.pluginRead(request) }, subjectId),
    staleTime: SUBJECT_STALE_MS,
    ...busyRetry,
  });
}

/**
 * Sections core could not address are resolved by their plugin when the page
 * opens: one `identity-resolve` invoke per plugin, all in parallel; core
 * answers with that plugin's updated sections. This core-owned write is the
 * recorded exception to "automatic requests stay read-only" (ADR 0036
 * amendment), so it runs once per page open and never again on focus,
 * reconnect or remount. A failed resolution leaves its sections "resolving"
 * and is reported per section with its retry.
 */
export function useResolvedSections(
  subjectId: string,
  sections: readonly SubjectSection[],
) {
  const api = useDeskApi();
  const plugins = [
    ...new Set(
      sections
        .filter((section) => section.status === "resolving")
        .map((section) => section.plugin),
    ),
  ];
  const resolutions = useQueries({
    queries: plugins.map((plugin) => ({
      queryKey: [
        "plugin",
        SUBJECT_PLUGIN,
        "identity-resolve",
        subjectId,
        plugin,
      ],
      queryFn: () =>
        resolveSections(
          { invoke: (request) => api.pluginInvoke(request) },
          subjectId,
          plugin,
        ),
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...busyRetry,
    })),
  });
  const failed = new Map<SubjectSection, () => void>();
  const resolved = sections.map((section) => {
    if (section.status !== "resolving") return section;
    const query = resolutions[plugins.indexOf(section.plugin)];
    const answer = query?.data?.find(
      (item) => item.section === section.section,
    );
    if (query?.isError) failed.set(section, () => void query.refetch());
    return answer ?? section;
  });
  return { sections: resolved, failed };
}

/** One profile or filings section read, keyed by its plugin so an access
 * change withdraws it (ADR 0036). */
export function useSectionRead(request: PluginRequest | null | undefined) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["plugin", request?.plugin, "section", request],
    queryFn: () => api.pluginRead(request as PluginRequest),
    enabled: Boolean(request),
    // Plugin content: every new mount rechecks native access, like other
    // plugin reads; a mount during a running read joins it.
    staleTime: 0,
    refetchOnMount: "always",
    ...busyRetry,
  });
}

/** A plugin's current widget declarations; module URLs carry the revision. */
export function useWidgetPresentation(plugin: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["plugin", plugin, "widgets"],
    queryFn: () => api.widgetPresentation(plugin),
    staleTime: SUBJECT_STALE_MS,
    ...busyRetry,
  });
}
