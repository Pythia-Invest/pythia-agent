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

/** The server owns native mutation, restart and readback. */
export function useChangeDeviceSetting() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (change: SettingChange) => {
      switch (change.kind) {
        case "skill":
          return api.setSkillEnabled(change.name, change.enabled);
        case "toolset":
          return api.setToolsetEnabled(change.name, change.enabled);
      }
    },
    onSuccess: async () => {
      await Promise.all(
        [deskKeys.settings, deskKeys.models, deskKeys.capabilities].map(
          (queryKey) => cache.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
