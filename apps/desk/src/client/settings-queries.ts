"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";

type SettingChange = {
  kind: "skill" | "toolset";
  name: string;
  enabled: boolean;
};

export function useDeviceSettings() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.settings,
    queryFn: () => api.settings(),
  });
}

export function useReleaseStatus() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.release,
    queryFn: () => api.updateStatus(),
  });
}

export function usePluginConfiguration() {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.pluginConfiguration,
    queryFn: () => api.pluginConfiguration.list(),
  });
}

type ConfigurationChange =
  | { action: "save"; plugin: string; key: string; value: string | null }
  | { action: "check"; plugin: string };

/** Saves a field or runs a plugin's check; responses carry no secret values. */
export function useChangePluginConfiguration() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (change: ConfigurationChange) =>
      change.action === "save"
        ? api.pluginConfiguration.set(change.plugin, change.key, change.value)
        : api.pluginConfiguration.check(change.plugin),
    onSettled: () =>
      cache.invalidateQueries({ queryKey: deskKeys.pluginConfiguration }),
  });
}

/** The server owns native mutation, restart and readback. */
export function useChangeDeviceSetting() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    mutationKey: ["native-settings"],
    onMutate: async () => {
      // Withdraw native contribution data while restart/readback changes authority.
      cache.setQueryData(deskKeys.topBar, { renderer: null, settings: {} });
      await cache.cancelQueries({ queryKey: deskKeys.plugins });
      cache.removeQueries({ queryKey: deskKeys.plugins });
      await cache.cancelQueries({ queryKey: deskKeys.topBar });
      cache.setQueryData(deskKeys.topBar, { renderer: null, settings: {} });
    },
    mutationFn: async (change: SettingChange) => {
      switch (change.kind) {
        case "skill":
          return api.setSkillEnabled(change.name, change.enabled);
        case "toolset":
          return api.setToolsetEnabled(change.name, change.enabled);
      }
    },
    onSettled: async () => {
      await Promise.all(
        [
          deskKeys.settings,
          deskKeys.models,
          deskKeys.capabilities,
          deskKeys.topBar,
          deskKeys.plugins,
        ].map((queryKey) => cache.invalidateQueries({ queryKey })),
      );
    },
  });
}
