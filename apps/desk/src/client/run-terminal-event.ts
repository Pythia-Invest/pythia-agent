import type { DeskRunEvent, RunStatus } from "@/server/types";

/**
 * The terminal event Hermes would have sent, rebuilt from a run's status.
 *
 * A stream can drop after the run has already finished, so the status endpoint
 * is the only place the outcome exists. Nothing is synthesized beyond what the
 * status actually carries, and an unfinished run yields null rather than a
 * guess at how it ended.
 */
export function terminalEvent(status: RunStatus): DeskRunEvent | null {
  const base = { run_id: status.run_id };
  if (status.status === "completed") {
    return {
      ...base,
      event: "run.completed",
      ...(status.output !== undefined ? { output: status.output } : {}),
      ...(status.usage ? { usage: status.usage } : {}),
      ...(status.pending_steer ? { pending_steer: status.pending_steer } : {}),
    };
  }
  if (status.status === "failed") {
    return {
      ...base,
      event: "run.failed",
      ...(status.error !== undefined ? { error: status.error } : {}),
      ...(status.code ? { code: status.code } : {}),
    };
  }
  if (["cancelled", "interrupted"].includes(status.status)) {
    return { ...base, event: "run.cancelled" };
  }
  return null;
}
