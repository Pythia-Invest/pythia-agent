"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { historyToMessages } from "./chat-message";
import { useDeskApi } from "./providers";

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
