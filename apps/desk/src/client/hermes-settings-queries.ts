"use client";

import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  AccountSignIn,
  AccountSignInStatus,
  AgentPlugin,
  CustomEndpoint,
  CustomEndpointInput,
  HermesConfigView,
  McpServer,
  ModelAssignment,
  ProvidersView,
} from "@/server/hermes-settings-contract";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";

/** Hermes's own settings, read and changed through Desk's server. */
export const hermesKeys = {
  config: ["hermes", "config"] as const,
  providers: ["hermes", "providers"] as const,
  endpoints: ["hermes", "endpoints"] as const,
  mcp: ["hermes", "mcp"] as const,
  plugins: ["hermes", "plugins"] as const,
};

const segment = encodeURIComponent;

function useHermesQuery<T>(key: QueryKey, path: string) {
  const api = useDeskApi();
  return useQuery({
    queryKey: key,
    queryFn: () => api.hermes<T>(path),
    staleTime: 30_000,
  });
}

/** A change whose reply is the refreshed list, written straight to its query. */
function useHermesChange<T, V>(
  key: QueryKey,
  send: (variables: V) => Promise<T>,
  also: QueryKey[] = [],
) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: async (data) => {
      cache.setQueryData(key, data);
      await Promise.all(
        also.map((queryKey) => cache.invalidateQueries({ queryKey })),
      );
    },
  });
}

export const useHermesConfig = () =>
  useHermesQuery<HermesConfigView>(hermesKeys.config, "config");

export function useSaveHermesConfig() {
  const api = useDeskApi();
  return useHermesChange(hermesKeys.config, (values: Record<string, unknown>) =>
    api.hermes<HermesConfigView>("config", { values }, "PATCH"),
  );
}

export const useProviders = () =>
  useHermesQuery<ProvidersView>(hermesKeys.providers, "providers");

/** New credentials change which models the picker offers. */
export function useSetProviderKey() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.providers,
    (change: { key: string; value: string | null }) =>
      api.hermes<ProvidersView>("keys", change),
    [deskKeys.models],
  );
}

export function useDisconnectAccount() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.providers,
    (id: string) =>
      api.hermes<ProvidersView>(`accounts/${segment(id)}`, {
        action: "disconnect",
      }),
    [deskKeys.models],
  );
}

export function useStartSignIn() {
  const api = useDeskApi();
  return useMutation({
    mutationFn: (id: string) =>
      api.hermes<AccountSignIn>(`accounts/${segment(id)}`, {
        action: "sign-in",
      }),
  });
}

/** Polls a device sign-in until it leaves `pending`. */
export function useSignInStatus(id: string, sessionId: string | undefined) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["hermes", "sign-in", id, sessionId],
    queryFn: () =>
      api.hermes<AccountSignInStatus>(
        `accounts/${segment(id)}/sign-in/${segment(sessionId ?? "")}`,
      ),
    enabled: Boolean(sessionId),
    refetchInterval: (query) =>
      !query.state.data || query.state.data.status === "pending"
        ? 2_000
        : false,
    retry: false,
  });
}

export function useCancelSignIn() {
  const api = useDeskApi();
  return useMutation({
    mutationFn: ({ id, sessionId }: { id: string; sessionId: string }) =>
      api.hermes(`accounts/${segment(id)}/sign-in/${segment(sessionId)}`, {}),
  });
}

export function useSetMainModel() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (choice: {
      provider: string;
      model: string;
      confirm?: boolean;
    }) => api.hermes<ModelAssignment>("model", choice),
    onSuccess: async (result) => {
      if (!result.ok) return;
      await Promise.all(
        [hermesKeys.config, deskKeys.models].map((queryKey) =>
          cache.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

export const useCustomEndpoints = () =>
  useHermesQuery<CustomEndpoint[]>(hermesKeys.endpoints, "endpoints");

export function useSaveCustomEndpoint() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.endpoints,
    (input: CustomEndpointInput) =>
      api.hermes<CustomEndpoint[]>("endpoints", input),
    [deskKeys.models, hermesKeys.config],
  );
}

export function useCustomEndpointAction() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.endpoints,
    ({ id, action }: { id: string; action: "activate" | "remove" }) =>
      api.hermes<CustomEndpoint[]>(`endpoints/${segment(id)}`, { action }),
    [deskKeys.models, hermesKeys.config],
  );
}

export const useMcpServers = () =>
  useHermesQuery<McpServer[]>(hermesKeys.mcp, "mcp");

export function useSetMcpServer() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.mcp,
    ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.hermes<McpServer[]>(`mcp/${segment(name)}`, { enabled }),
  );
}

export const useAgentPlugins = () =>
  useHermesQuery<AgentPlugin[]>(hermesKeys.plugins, "plugins");

export function useSetAgentPlugin() {
  const api = useDeskApi();
  return useHermesChange(
    hermesKeys.plugins,
    ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.hermes<AgentPlugin[]>(`plugins/${segment(name)}`, { enabled }),
  );
}
