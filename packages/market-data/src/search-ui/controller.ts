"use client";
import {
  investmentSearchResponseSchema,
  investmentAdoptResponseSchema,
  type InvestmentSearchResult,
  type InvestmentSearchReference,
  type InvestmentAdoptData,
} from "../search";
import { useMutation, useQuery, useQueryClient } from "@pythia/widget-sdk";
import { useEffect, useState } from "react";
import type { TopBarContext } from "@pythia/widget-sdk";

export type SearchTransport = TopBarContext["transport"];
export const investmentSearchKey = [
  "plugin",
  "pythia-market-data",
  "search",
] as const;
import { z } from "zod";

const searchSourcesSchema = z.object({
  search_sources: z.array(z.string()),
});

const progressSchema = z.object({
  progress: z.array(
    z.object({
      provider: z.string(),
      status: z.string(),
      elapsed_ms: z.number().nonnegative(),
    }),
  ),
  result: investmentSearchResponseSchema.optional(),
});

export function searchSourcesOptions(transport: SearchTransport) {
  return {
    queryKey: [...investmentSearchKey, "sources"],
    queryFn: async ({ signal }: { signal: AbortSignal }) =>
      searchSourcesSchema.parse(
        await transport.read(
          {
            plugin: "pythia-market-data",
            operation: "query",
            arguments: { action: "describe" },
          },
          signal,
        ),
      ).search_sources,
    staleTime: 60_000,
    retry: false as const,
  };
}

export function useSearchSources(transport: SearchTransport, enabled: boolean) {
  return useQuery({ ...searchSourcesOptions(transport), enabled });
}

export type AdoptedInvestment = {
  result: InvestmentSearchResult;
  data: InvestmentAdoptData;
  revision: number;
  issues: { code: string; message: string }[];
};
export function useAdoptInvestment(
  transport: SearchTransport,
  onSuccess: (value: AdoptedInvestment) => void,
) {
  return useMutation({
    mutationFn: async ({
      result,
      revision,
      reference: explicitReference,
    }: {
      result: InvestmentSearchResult;
      revision: number;
      reference?: InvestmentSearchReference;
    }) => {
      const references = result.references.filter((item) => item.available);
      const reference = explicitReference ?? references[0];
      const scope = explicitReference ? explicitReference.kind : result.kind;
      if (!reference?.available || !scope)
        throw Error(
          "This investment cannot be selected until its source is available and its type is known.",
        );
      const response = await adoptInvestment(transport, reference, scope);
      return {
        result,
        revision,
        data: response.data,
        issues: response.issues,
      };
    },
    onSuccess,
  });
}

export function useInvestmentSearch(
  transport: SearchTransport,
  query: string,
  enabled: boolean,
  providers?: string[],
) {
  const client = useQueryClient();
  const providerKey = JSON.stringify(providers);
  const key = [...investmentSearchKey, query, providerKey];
  const progressKey = JSON.stringify(key);
  const [progress, setProgress] = useState<{
    key: string;
    rows: z.infer<typeof progressSchema>["progress"];
  }>({ key: "", rows: [] });
  const result = useQuery({
    ...investmentSearchOptions(transport, query, providers, (rows) =>
      setProgress({ key: progressKey, rows }),
    ),
    enabled: enabled && query.length > 0,
  });
  // The observer applies enabled:false in useQuery's effect first. Only then
  // can this instance release the request if no other observer still needs it.
  useEffect(() => {
    if (!enabled) void releaseInvestmentSearch(client, query, providerKey);
  }, [client, query, enabled, providerKey]);
  return {
    ...result,
    progress: progress.key === progressKey ? progress.rows : [],
  };
}

/** QueryObserver releases unmounted demand itself. A closed but mounted search
 * also releases demand, only after every observer of this key is inactive. */
export function releaseInvestmentSearch(
  client: ReturnType<typeof useQueryClient>,
  query: string,
  providerKey?: string,
) {
  return client.cancelQueries({
    queryKey: [...investmentSearchKey, query, providerKey],
    exact: true,
    type: "inactive",
    fetchStatus: "fetching",
  });
}

export function investmentSearchOptions(
  transport: SearchTransport,
  query: string,
  providers?: string[],
  onProgress: (
    rows: z.infer<typeof progressSchema>["progress"],
  ) => void = () => {},
) {
  return {
    queryKey: [...investmentSearchKey, query, JSON.stringify(providers)],
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      onProgress([]);
      for await (const event of transport.updates(
        [
          {
            plugin: "pythia-market-data",
            operation: "query",
            arguments: {
              action: "search_catalogue",
              query,
              limit: 20,
              ...(providers ? { providers } : {}),
            },
          },
        ],
        signal,
      )) {
        if (signal.aborted) throw Error("Search cancelled.");
        if (event.type === "snapshot") {
          const update = progressSchema.parse(event.data);
          onProgress(update.progress);
          if (update.result) return update.result;
        } else if (event.state === "unavailable" || event.state === "stale") {
          throw Error("Search updates are unavailable. Retry search.");
        }
      }
      throw Error("Search ended before results arrived.");
    },
    retry: false as const,
    // Display snapshots only; backend authorization still governs every operation.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  };
}

/** An explicit exclusion narrows both live searches and retained catalogue rows. */
export function searchProviders(
  sources: readonly string[] | undefined,
  excluded: readonly string[],
): string[] | undefined {
  return excluded.length
    ? (sources ?? []).filter((provider) => !excluded.includes(provider))
    : undefined;
}

export async function adoptInvestment(
  transport: SearchTransport,
  reference: InvestmentSearchReference,
  scope: NonNullable<InvestmentSearchResult["kind"]>,
) {
  if (!reference.available)
    throw Error("This investment source is unavailable.");
  const raw = await transport.invoke({
    plugin: "pythia-market-data",
    operation: "query",
    arguments: {
      action: "adopt_search",
      native_ref: reference.native_ref,
      scope,
      binding_mode: "source",
    },
  });
  const failure = z
    .object({
      outcome: z.literal("error"),
      issues: z.array(z.object({ message: z.string() })).min(1),
    })
    .safeParse(raw);
  if (failure.success)
    throw Error(failure.data.issues.map((issue) => issue.message).join(" "));
  return investmentAdoptResponseSchema.parse(raw);
}
