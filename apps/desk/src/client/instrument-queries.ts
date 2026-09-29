"use client";
import {
  parseFilingDocument,
  readSubject,
  resolveSections,
  SUBJECT_PLUGIN,
  SUBJECT_STALE_MS,
  type SubjectSection,
  subjectQueryKey,
} from "@pythia/market-data/subject";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** One subject's page composition: a fast local core read. Search never
 * prefetches it: a subject read queues the build's questions about it. */
export function useSubjectPage(subjectId: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: subjectQueryKey(subjectId),
    queryFn: () =>
      readSubject({ read: (request) => api.pluginRead(request) }, subjectId),
    staleTime: SUBJECT_STALE_MS,
    // Switching to another listing of the same instrument keeps the page on
    // screen while that listing's composition loads; another instrument
    // starts from its own skeleton.
    placeholderData: (previous) =>
      previous?.listings.some((listing) => listing.id === subjectId)
        ? previous
        : undefined,
    ...busyRetry,
  });
}

/**
 * Sections core could not address are resolved by their plugin when the page
 * opens, as is a combined section's source still to be looked up: one
 * `identity-resolve` invoke per plugin, all in parallel; core answers with the
 * sections that plugin can serve. This core-owned write is the recorded
 * exception to "automatic requests stay read-only" (ADR 0036 amendment), so
 * it runs once per page open and never again on focus, reconnect or remount.
 * A resolution changes what core composes (a miss hands a section to the next
 * source, a new binding joins the combined filings), so it is read again. A
 * failed resolution leaves its sections "resolving" and is reported per
 * section with its retry.
 */
export function useResolvedSections(
  subjectId: string,
  /** The page's instrument: issuer-level sections (profile, filings) resolve
   * once for it, not again for every listing the investor switches to. */
  instrumentId: string,
  sections: readonly SubjectSection[],
) {
  const api = useDeskApi();
  const client = useQueryClient();
  const plugins = [
    ...new Set(
      sections.flatMap((section) => [
        ...(section.status === "resolving" ? [section.plugin] : []),
        ...section.skipped
          .filter((skip) => skip.code === "resolving")
          .map((skip) => skip.plugin),
      ]),
    ),
  ];
  // Core says which level each section's plugin addresses it through.
  const issuerLevel = (plugin: string) =>
    sections.every(
      (section) => section.plugin !== plugin || section.via === "issuer",
    );
  const resolutions = useQueries({
    queries: plugins.map((plugin) => {
      const subject = issuerLevel(plugin) ? instrumentId : subjectId;
      return {
        queryKey: [
          "plugin",
          SUBJECT_PLUGIN,
          "identity-resolve",
          subject,
          plugin,
        ],
        queryFn: async () => {
          const answer = await resolveSections(
            { invoke: (request) => api.pluginInvoke(request) },
            subject,
            plugin,
          );
          // This page's compositions, and core's reads of the sections the
          // plugin serves (the combined filings), are read again.
          for (const id of new Set([subjectId, instrumentId]))
            void client.invalidateQueries({ queryKey: subjectQueryKey(id) });
          for (const section of answer)
            if (section.request?.plugin === SUBJECT_PLUGIN)
              void client.invalidateQueries({
                queryKey: [
                  "plugin",
                  SUBJECT_PLUGIN,
                  "section",
                  section.request,
                ],
              });
          return answer;
        },
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        ...busyRetry,
      };
    }),
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

/** One read of a filing's document (core's `filings-read`). A filed document
 * never changes, so an answer stays fresh; core keeps its text on disk. */
export function useFilingDocument(request: PluginRequest | null) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["plugin", request?.plugin, "filings-read", request],
    queryFn: async () =>
      parseFilingDocument(await api.pluginRead(request as PluginRequest)),
    enabled: Boolean(request),
    staleTime: Infinity,
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
