"use client";
import {
  investmentSearchResponseSchema,
  type InvestmentSearchResult,
  type InvestmentAdoptData,
} from "@pythia/market-data/search";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useDeskApi } from "./providers";

export type AdoptedInvestment = {
  result: InvestmentSearchResult;
  data: InvestmentAdoptData;
  revision: number;
  issues: { code: string; message: string }[];
};
export function useAdoptInvestment(
  onSuccess: (value: AdoptedInvestment) => void,
) {
  const api = useDeskApi();
  return useMutation({
    mutationFn: async ({
      result,
      revision,
    }: {
      result: InvestmentSearchResult;
      revision: number;
    }) => {
      const reference = result.references.find((item) => item.available);
      if (!reference || !result.kind)
        throw Error(
          "This investment cannot be selected until its source is available and its type is known.",
        );
      const response = await api.adoptInvestment({
        native_ref: reference.native_ref,
        scope: result.kind,
      });
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

export function useInvestmentSearch(query: string, enabled: boolean) {
  const api = useDeskApi();
  const client = useQueryClient();
  useEffect(
    () => () => {
      void client.cancelQueries({
        queryKey: ["investment-search", query],
        exact: true,
      });
    },
    [client, query],
  );
  useEffect(() => {
    if (!enabled)
      void client.cancelQueries({
        queryKey: ["investment-search", query],
        exact: true,
      });
  }, [client, query, enabled]);
  return useQuery({
    queryKey: ["investment-search", query],
    queryFn: async ({ signal }) =>
      investmentSearchResponseSchema.parse(
        await api.pluginRead(
          {
            plugin: "pythia-market-data",
            operation: "query",
            arguments: { action: "search_catalogue", query, limit: 20 },
          },
          signal,
        ),
      ),
    enabled: enabled && query.length > 0,
    retry: false,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
}
