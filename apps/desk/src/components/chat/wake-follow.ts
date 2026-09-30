import type { DeskUIMessage } from "@/client/chat-message";
import type { WorkAgent } from "@/work/types";
import { activityTurn } from "./turn-model";

/**
 * Hermes answers a finished background delegation with a turn it starts
 * itself (gateway/wake.py self-posts /v1/chat/completions), outside any run
 * Desk streams. The turn is saved to the session "for the client to poll", so
 * after research agents end Desk refreshes the transcript until the reply is
 * there, within Hermes's own wake timeout (WAKE_TURN_TIMEOUT_SECONDS, 600s)
 * plus its retry delays.
 */
export const WAKE_WINDOW_MS = 660_000;

/**
 * How the transcript shows a reply Desk does not stream: "reply" while none of
 * it is saved, "tail" while the last turn is that reply in progress.
 */
export type AwaitingReply = "reply" | "tail" | false;

export function wakeFollow(
  agents: readonly WorkAgent[],
  messages: readonly DeskUIMessage[],
  busy: boolean,
  now: number,
): { poll: boolean; show: AwaitingReply } {
  const idle = { poll: false, show: false as const };
  // A run Desk streams brings its own answer; agents still working have not
  // been reported back yet.
  if (busy || agents.some((agent) => agent.status === "running")) return idle;
  const ended = Math.max(
    0,
    ...agents.flatMap((agent) =>
      agent.endedAt && now - agent.endedAt * 1000 < WAKE_WINDOW_MS
        ? [agent.endedAt * 1000]
        : [],
    ),
  );
  const last = messages.at(-1);
  if (!ended || !last) return idle;
  // The wake turn opens with Hermes's delegation notice.
  const note = messages.at(-2)?.metadata?.note;
  const afterNotice =
    note === "async_delegation_complete" ||
    note === "async_delegation_incomplete";
  if (last.role === "assistant" && afterNotice)
    return activityTurn(last, false).answer
      ? idle
      : { poll: true, show: "tail" };
  // Keep reading until the notice and its answer are saved. Say that Pythia
  // is working only when the last turn provably predates the agent's end.
  const saved =
    last.role === "assistant" ? (last.metadata?.run?.completedAt ?? 0) : 0;
  return { poll: true, show: saved < ended ? "reply" : false };
}
