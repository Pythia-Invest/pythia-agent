"use client";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";

/** Re-read file selection and native access together; a cached code module does
 * not grant access. External configuration changes appear on focus or polling. */
export function useTopBarSelection() {
  const api = useDeskApi();
  const changing = useIsMutating({ mutationKey: ["native-settings"] }) > 0;
  const query = useQuery({
    enabled: !changing,
    queryKey: deskKeys.topBar,
    queryFn: ({ signal }) => api.topBar(signal),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    retry: false,
  });
  return {
    ...query,
    data: changing || !query.isFetchedAfterMount ? undefined : query.data,
  };
}
