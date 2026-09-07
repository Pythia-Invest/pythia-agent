"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { DeskApi, DeskApiError } from "./api";

const DeskApiContext = createContext<DeskApi | null>(null);

/** Hermes availability is not something a retry fixes within a second. */
function retry(failureCount: number, error: unknown) {
  if (error instanceof DeskApiError && error.status < 500) return false;
  return failureCount < 1;
}

/**
 * One Desk API client and one TanStack Query cache for the browser session.
 * Server state (sessions, messages, runs) flows through queries and mutations
 * here; local UI preferences stay in component state or localStorage.
 */
export function DeskProviders({ children }: { children: ReactNode }) {
  const [api] = useState(() => new DeskApi());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry, staleTime: 10_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <DeskApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </DeskApiContext.Provider>
  );
}

export function useDeskApi() {
  const api = useContext(DeskApiContext);
  if (!api) throw new Error("useDeskApi requires DeskProviders.");
  return api;
}
