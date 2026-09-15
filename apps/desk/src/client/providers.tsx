"use client";

import { DeskDrafts } from "./desk-drafts";
import { DeskViewPublisher } from "./desk-view-publisher";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useState,
  useEffect,
} from "react";
import { DeskChats } from "./desk-chat";
import { DeskApi, DeskApiError } from "./api";

const DeskDraftsContext = createContext<DeskDrafts | null>(null);
const DeskViewContext = createContext<DeskViewPublisher | null>(null);

const DeskChatsContext = createContext<DeskChats | null>(null);

const DeskApiContext = createContext<DeskApi | null>(null);

/**
 * Client errors are final. Upstream and network failures get two quick
 * retries with backoff, which covers a Hermes restart or a Desk reload
 * without hiding a real outage behind endless spinners.
 */
function retry(failureCount: number, error: unknown) {
  if (error instanceof DeskApiError && error.status < 500) return false;
  return failureCount < 2;
}

function retryDelay(attempt: number) {
  return Math.min(500 * 2 ** attempt, 3_000);
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
          queries: {
            retry,
            retryDelay,
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [drafts] = useState(() => new DeskDrafts());
  const [view] = useState(() => new DeskViewPublisher(api));
  const [chats] = useState(() => new DeskChats(api, queryClient, view));
  useEffect(() => view.start(), [view]);
  return (
    <DeskApiContext.Provider value={api}>
      <QueryClientProvider client={queryClient}>
        <DeskChatsContext.Provider value={chats}>
          <DeskDraftsContext.Provider value={drafts}>
            <DeskViewContext.Provider value={view}>
              {children}
            </DeskViewContext.Provider>
          </DeskDraftsContext.Provider>
        </DeskChatsContext.Provider>
      </QueryClientProvider>
    </DeskApiContext.Provider>
  );
}

export function useDeskApi() {
  const api = useContext(DeskApiContext);
  if (!api) throw new Error("useDeskApi requires DeskProviders.");
  return api;
}

export function useDeskChats() {
  const chats = useContext(DeskChatsContext);
  if (!chats) throw new Error("useDeskChats requires DeskProviders.");
  return chats;
}

export function useDeskDrafts() {
  const drafts = useContext(DeskDraftsContext);
  if (!drafts) throw new Error("useDeskDrafts requires DeskProviders.");
  return drafts;
}
export function useDeskView() {
  const view = useContext(DeskViewContext);
  if (!view) throw new Error("useDeskView requires DeskProviders.");
  return view;
}
