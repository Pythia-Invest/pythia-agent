"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { DeskReleaseStatus } from "@/server/release-status";
import { DeskApiError } from "./api";
import {
  useCheckUpdate,
  useReleaseCheck,
  useReleaseStatus,
  useStartUpdate,
} from "./settings-queries";
import { updateComplete } from "./update-progress";

/*
 * One update, whichever surface started it: About, the update dialog or the
 * sidebar indicator read the same state, so starting in one shows progress
 * in all. The release status itself stays in the query cache.
 */

type Requested = { revision: string; time: number };
type State = { requested: Requested | null; timedOut: boolean };

const WAIT_MS = 600_000;
let state: State = { requested: null, timedOut: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const CHECKED_KEY = "pythia.updates.checked-at";
const DAY_MS = 86_400_000;

export function lastChecked() {
  try {
    const value = Number(window.localStorage.getItem(CHECKED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function markChecked() {
  try {
    window.localStorage.setItem(CHECKED_KEY, String(Date.now()));
  } catch {
    // Without storage the next visit simply checks again.
  }
}

const REMOTE = [
  "status",
  "update_available",
  "target_revision",
  "target_version",
  "checkout_clean",
  "message",
] as const;

/** What only a remote check knows, leaving out what it didn't say. */
function remote(checked: DeskReleaseStatus): Partial<DeskReleaseStatus> {
  return Object.fromEntries(
    REMOTE.flatMap((key) =>
      checked[key] === undefined ? [] : [[key, checked[key]]],
    ),
  );
}

export type UpdatePhase =
  | "loading"
  | "checking"
  | "current"
  | "available"
  | "starting"
  | "running"
  | "complete"
  | "failed"
  | "waiting"
  | "unavailable"
  | "unknown";

export function useUpdateFlow() {
  const { requested, timedOut } = useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
  const query = useReleaseStatus(
    requested && !timedOut
      ? { target: requested.revision, until: requested.time + WAIT_MS }
      : undefined,
  );
  const check = useCheckUpdate();
  const start = useStartUpdate();
  const checked = useReleaseCheck().data;
  const local = query.data;
  // A local read knows the installed build and the updater; only a remote
  // check knows what is available. A check of another build no longer applies.
  const release: DeskReleaseStatus | undefined =
    checked && local && checked.current_revision === local.current_revision
      ? { ...local, ...remote(checked) }
      : local;
  const complete = Boolean(
    requested && updateComplete(release, requested.revision),
  );
  const failed =
    release?.updater === "failed" &&
    (!requested || (!start.isPending && query.dataUpdatedAt > requested.time));
  const running =
    !complete &&
    !failed &&
    (Boolean(requested) || release?.updater === "running");
  const unavailable = release?.code === "release_command_unavailable";
  const available =
    !complete &&
    release?.status === "ready" &&
    release.update_available === true;
  const blocked = release?.checkout_clean === false;
  const canApply =
    available &&
    !blocked &&
    release?.apply_supported === true &&
    Boolean(release?.target_revision && release?.current_revision);

  useEffect(() => {
    if (!requested || complete || failed) return;
    const timer = setTimeout(
      () => set({ timedOut: true }),
      Math.max(0, requested.time + WAIT_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [requested, complete, failed]);

  const phase: UpdatePhase = complete
    ? "complete"
    : failed
      ? "failed"
      : timedOut
        ? "waiting"
        : running
          ? "running"
          : start.isPending
            ? "starting"
            : check.isPending
              ? "checking"
              : available
                ? "available"
                : unavailable
                  ? "unavailable"
                  : query.isPending
                    ? "loading"
                    : release?.status === "ready" &&
                        release.update_available === false
                      ? "current"
                      : "unknown";

  return {
    release,
    phase,
    requested: Boolean(requested),
    blocked,
    canApply,
    manual: available && release?.apply_supported !== true,
    busy: check.isPending || start.isPending || running,
    error:
      complete || running ? null : (start.error ?? check.error ?? query.error),
    unreachable: query.isError || timedOut,
    check() {
      start.reset();
      check.mutate(undefined, { onSuccess: markChecked });
    },
    apply() {
      if (!release?.current_revision || !release.target_revision) return;
      set({
        timedOut: false,
        requested: { revision: release.target_revision, time: Date.now() },
      });
      start.mutate(
        { current: release.current_revision, target: release.target_revision },
        {
          onError: (error) => {
            if (
              error instanceof DeskApiError &&
              error.status >= 400 &&
              error.status < 500
            )
              set({ requested: null });
          },
        },
      );
    },
    retry() {
      set({
        timedOut: false,
        requested: requested ? { ...requested, time: Date.now() } : null,
      });
      void query.refetch();
    },
  };
}

/**
 * Checks for updates once a day while Desk is open, as Hermes Desktop does:
 * on load and when the window regains focus after a day has passed.
 */
export function useDailyUpdateCheck() {
  const check = useCheckUpdate();
  const mutate = check.mutate;
  useEffect(() => {
    const due = () => {
      const checked = lastChecked();
      if (checked !== null && Date.now() - checked <= DAY_MS) return;
      // Recorded first, so a second mount or tab doesn't check again.
      markChecked();
      mutate();
    };
    due();
    window.addEventListener("focus", due);
    return () => window.removeEventListener("focus", due);
  }, [mutate]);
}
