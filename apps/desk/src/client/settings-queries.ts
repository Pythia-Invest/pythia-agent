"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeskReleaseStatus } from "@/server/release-status";
import { useDeskApi } from "./providers";
import { deskKeys } from "./query-cache";
import { updateComplete } from "./update-progress";

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

export function useReleaseStatus(watch?: { target: string; until: number }) {
  const api = useDeskApi();
  return useQuery({
    queryKey: deskKeys.release,
    queryFn: () => api.updateStatus(),
    refetchInterval: (query) => {
      const data = query.state.data;
      // A Desk that stays unreachable for the whole update window stops being
      // polled; Retry connection asks again.
      if (query.state.fetchFailureCount >= 200) return false;
      if (data?.updater === "running") return 3_000;
      return watch &&
        Date.now() < watch.until &&
        !updateComplete(data, watch.target) &&
        data?.updater !== "failed"
        ? 3_000
        : false;
    },
    retry: false,
  });
}

/** A remote check; its answer is kept for every update surface to read. */
export function useCheckUpdate() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => api.updateStatus(true),
    retry: false,
    onSuccess: (status) => cache.setQueryData(deskKeys.releaseCheck, status),
  });
}

export function useStartUpdate() {
  const api = useDeskApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (expected: { current: string; target: string }) =>
      api.startUpdate(expected),
    retry: false,
    onSettled: () => cache.invalidateQueries({ queryKey: deskKeys.release }),
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

/** The last remote check, if any; it never refetches on its own. */
export function useReleaseCheck() {
  const cache = useQueryClient();
  return useQuery({
    queryKey: deskKeys.releaseCheck,
    queryFn: () =>
      cache.getQueryData<DeskReleaseStatus>(deskKeys.releaseCheck) ?? null,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
