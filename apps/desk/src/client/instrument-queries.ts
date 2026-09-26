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
import { useDeskApi } from "./providers";

/** One subject's page composition: a fast local core read. The search bar
 * prefetches the same key while a row is highlighted. */
export function useSubjectPage(subjectId: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: subjectQueryKey(subjectId),
    queryFn: ({ signal }) =>
      readSubject({ read: api.pluginRead.bind(api) }, subjectId, signal),
    staleTime: SUBJECT_STALE_MS,
    retry: false,
  });
}

/** Sections whose address core could not derive are resolved by their
 * plugin, one invoke per plugin, all in parallel; core answers with that
 * plugin's updated sections. Other sections pass through untouched. A failed resolution stays "resolving" and is reported in
 * `failed` with its retry, so the section shows the failure, not a verdict. */
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
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        resolveSections(
          { invoke: api.pluginInvoke.bind(api) },
          subjectId,
          plugin,
          signal,
        ),
      staleTime: SUBJECT_STALE_MS,
      retry: false,
    })),
  });
  const failed = new Map<string, () => void>();
  resolutions.forEach((query, index) => {
    const plugin = plugins[index];
    if (plugin && query.isError) failed.set(plugin, () => void query.refetch());
  });
  const resolved = sections.map((section) => {
    if (section.status !== "resolving") return section;
    const answer = resolutions[plugins.indexOf(section.plugin)]?.data;
    return answer?.find((item) => item.section === section.section) ?? section;
  });
  return { sections: resolved, failed };
}

/** A plugin's current widget declarations; module URLs carry the revision. */
export function useWidgetPresentation(plugin: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["plugin", plugin, "widgets"],
    queryFn: ({ signal }) => api.widgetPresentation(plugin, signal),
    staleTime: SUBJECT_STALE_MS,
    retry: false,
  });
}
