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
    // No abort signal: a remount joins the running check instead of aborting
    // it and re-issuing the same native widget read, which admission refuses
    // (429) while the cancelled copy finishes. Focus bursts within 5 s share
    // one check; the 15 s recheck is unchanged (ADR 0036).
    queryFn: () => api.topBar(),
    staleTime: 5_000,
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
