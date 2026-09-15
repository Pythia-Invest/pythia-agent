"use client";

import { workspaceKeys } from "@/workspace/query-keys";
export { workspaceKeys } from "@/workspace/query-keys";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { historyToMessages } from "./chat-message";
import { useDeskApi } from "./providers";
import { useCallback } from "react";

import { deskKeys, MESSAGE_PAGE_SIZE } from "./query-cache";
export { deskKeys, refreshMessages } from "./query-cache";

/**
 * The Hermes session list, newest first as Hermes returns it. While the list
 * cannot be fetched (Hermes restarting, Desk redeploying) the query polls
 * every few seconds so the sidebar recovers without a manual reload.
 */
export function useSessions() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.sessions,
    queryFn: () => api.listSessions(),
    refetchInterval: (query) =>
      query.state.status === "error" ? 5_000 : false,
  });
}

/** One chat's transcript from Hermes, already folded into UI messages. */
export function useMessages(sessionId: string) {
  const api = useDeskApi();
  return useInfiniteQuery({
    queryKey: deskKeys.messages(sessionId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listMessages(sessionId, MESSAGE_PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.returned === lastPage.limit
        ? lastPage.offset + lastPage.returned
        : undefined,
    select: (result) => ({
      ...result,
      pages: historyToMessages(
        [...result.pages].reverse().flatMap((page) => page.data),
      ),
    }),
  });
}

export function useModelOptions() {
  const api = useDeskApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: deskKeys.models,
    queryFn: () => api.modelOptions(),
  });
  const refresh = useMutation({
    mutationFn: () => api.modelOptions(true),
    onSuccess: (catalog) => {
      queryClient.setQueryData(deskKeys.models, catalog);
    },
  });
  return {
    ...query,
    isRefreshing: refresh.isPending,
    refreshModels: refresh.mutate,
  };
}

export function useCapabilities() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.capabilities,
    queryFn: () => api.capabilities(),
  });
}

/** Uploads are explicit mutations; reads never cause files to be uploaded again. */
export function useUploadAttachment() {
  const api = useDeskApi();
  return useMutation({
    mutationFn: async ({
      file,
      signal,
    }: {
      file: File;
      signal: AbortSignal;
    }) => {
      const data = await new Promise<string>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Upload cancelled", "AbortError"));
          return;
        }
        const reader = new FileReader();
        const abort = () => reader.abort();
        signal.addEventListener("abort", abort, { once: true });
        reader.onloadend = () => signal.removeEventListener("abort", abort);
        reader.onerror = () =>
          reject(
            new Error("This file could not be read. Try attaching it again."),
          );
        reader.onabort = () =>
          reject(new DOMException("Upload cancelled", "AbortError"));
        reader.onload = () =>
          resolve(String(reader.result).split(",", 2)[1] ?? "");
        reader.readAsDataURL(file);
      });
      return api.uploadAttachment(
        { name: file.name, mediaType: file.type, data },
        signal,
      );
    },
    retry: false,
  });
}

export function useDownloadAttachment() {
  const api = useDeskApi();
  return useMutation({
    mutationFn: (id: string) => api.downloadAttachment(id),
    retry: false,
  });
}

export function useWorkspaceEntry(path: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: workspaceKeys.entry(path),
    staleTime: 5_000,
    queryFn: ({ signal }) => api.workspaceEntry(path, signal),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkspaceList(path: string, enabled = true) {
  const api = useDeskApi();
  return useQuery({
    queryKey: workspaceKeys.list(path),
    staleTime: 5_000,
    queryFn: ({ signal }) => api.workspaceList(path, signal),
    refetchInterval: 5_000,
    enabled,
    refetchOnWindowFocus: true,
  });
}

/** Warm only the row the user is approaching; never prefetch the whole tree. */
export function usePrefetchWorkspaceEntry() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useCallback(
    (path: string) => {
      void cache.prefetchQuery({
        queryKey: workspaceKeys.entry(path),
        queryFn: ({ signal }) => api.workspaceEntry(path, signal),
        staleTime: 5_000,
      });
    },
    [api, cache],
  );
}

export function useWorkspaceText(
  path: string,
  revision: string,
  enabled: boolean,
) {
  const api = useDeskApi();
  return useQuery({
    queryKey: workspaceKeys.text(path, revision),
    queryFn: ({ signal }) => api.workspaceText(path, signal),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === path ? previous : undefined,
    enabled,
  });
}

export function useResolveWorkspaceHostPath() {
  const api = useDeskApi();
  return useMutation({
    mutationFn: (path: string) => api.resolveWorkspaceHostPath(path),
  });
}

export function useWorkspaceSearch(path: string, q: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: workspaceKeys.search(path, q),
    queryFn: ({ signal }) => api.workspaceSearch(path, q, signal),
    enabled: q.trim().length > 0,
    gcTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSessionContext(sessionId: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["sessions", sessionId, "context"],
    queryFn: ({ signal }) => api.sessionContext(sessionId, signal),
    refetchOnWindowFocus: true,
  });
}
