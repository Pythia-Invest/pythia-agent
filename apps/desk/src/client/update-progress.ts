import type { DeskReleaseStatus } from "@/server/release-status";

/** Activation alone does not prove the lifecycle finished restoring services. */
export function updateComplete(
  status: DeskReleaseStatus | undefined,
  target: string,
) {
  return (
    status?.current_revision === target &&
    status.updater === "idle" &&
    status.last_update?.phase === "complete" &&
    status.last_update.target_revision === target
  );
}
