import type { DeskUIMessage } from "./chat-message";
import { userText } from "./chat-message";

function rowIds(message: DeskUIMessage) {
  return message.metadata?.historyRows ?? [message.id];
}

function sharesRows(left: DeskUIMessage, right: DeskUIMessage) {
  const ids = new Set(rowIds(left));
  return rowIds(right).some((id) => ids.has(id));
}

function enrich(saved: DeskUIMessage, live: DeskUIMessage): DeskUIMessage {
  return {
    ...saved,
    id: live.id,
    metadata: {
      ...saved.metadata,
      ...live.metadata,
      historyRows: rowIds(saved),
    },
    parts: [
      ...live.parts.filter((part) => part.type === "data-approval"),
      ...saved.parts.filter(
        (part) =>
          part.type !== "data-approval" ||
          !live.parts.some(
            (candidate) =>
              candidate.type === "data-approval" &&
              candidate.data.runId === part.data.runId &&
              candidate.data.requestId === part.data.requestId,
          ),
      ),
    ],
  };
}

/** Replace a completed transcript only if it contains the same submitted turn
 * and final answer. A late fetch must never erase a follow-up or partial reply. */
export function reconcileCompletedHistory(
  current: DeskUIMessage[],
  history: DeskUIMessage[],
  completedMessageId: string,
): DeskUIMessage[] {
  const live = current.at(-1);
  const saved = history.at(-1);
  if (
    live?.id !== completedMessageId ||
    live.metadata?.outcome !== "completed" ||
    saved?.role !== "assistant"
  )
    return current;
  const finalText = (message: DeskUIMessage) =>
    message.parts.findLast((part) => part.type === "text")?.text ?? "";
  if (finalText(live) !== finalText(saved)) return current;

  // A reload may hydrate the persisted answer before recovering its terminal
  // run status. Identify that adjacent copy by native rows, never answer text.
  const previous = current.at(-2);
  if (previous?.role === "assistant" && sharesRows(previous, saved)) {
    return [...current.slice(0, -2), enrich(enrich(saved, previous), live)];
  }
  const users = current.filter((message) => message.role === "user");
  const savedUsers = history.filter((message) => message.role === "user");
  // A bounded native refresh may omit loaded older pages. Only a matching
  // native ID can establish that prefix; equal prompt text is not an anchor.
  const firstKnownUser = users.findIndex(
    (message) => message.id === savedUsers[0]?.id,
  );
  const comparableUsers = users.slice(Math.max(0, firstKnownUser));
  if (
    comparableUsers.length !== savedUsers.length ||
    comparableUsers.some((message, index) => {
      const savedUser = savedUsers[index];
      const files = (turn: DeskUIMessage) =>
        turn.parts
          .filter((part) => part.type === "file")
          .map((part) => part.url);
      return (
        !savedUser ||
        userText(message) !== userText(savedUser) ||
        JSON.stringify(files(message)) !== JSON.stringify(files(savedUser))
      );
    })
  )
    return current;
  // Native history owns arguments and results; retain run-only approvals and
  // earlier failures that Hermes does not persist as transcript rows.
  return [...current.slice(0, -1), enrich(saved, live)];
}

/** Prepend older records and complete a turn split across native row pages.
 * Only the overlapping boundary can change; the live tail remains untouched. */
export function prependHistory(
  current: DeskUIMessage[],
  history: DeskUIMessage[],
): DeskUIMessage[] {
  const first = current[0];
  if (!first) return history.length ? history : current;
  const overlap = history.findIndex((message) => sharesRows(first, message));
  const boundary = history[overlap];
  if (!boundary) return current;
  const expanded = rowIds(boundary).indexOf(rowIds(first)[0] ?? first.id) > 0;
  if (overlap === 0 && !expanded) return current;
  return [
    ...history.slice(0, overlap),
    // Keep the older native ID so scroll anchoring observes the expanded page.
    ...(expanded
      ? [{ ...enrich(boundary, first), id: boundary.id }, ...current.slice(1)]
      : current),
  ];
}

/** Adopt newer native turns only after the retained tail is known to Hermes.
 * Unpersisted local turns remain untouched, as do earlier loaded pages and
 * run-only approvals/failures. Call only while the SDK is idle. */
export function appendHistory(
  current: DeskUIMessage[],
  history: DeskUIMessage[],
): DeskUIMessage[] {
  const tail = current.at(-1);
  if (!tail) return history.length ? history : current;
  const anchor = history.findLastIndex((message) => sharesRows(tail, message));
  const saved = history[anchor];
  if (!saved) return current;
  const knownRows = rowIds(tail);
  const savedRows = rowIds(saved);
  const start = savedRows.indexOf(knownRows[0] ?? tail.id);
  const expanded =
    start >= 0 &&
    start + knownRows.length < savedRows.length &&
    knownRows.every((id, index) => id === savedRows[start + index]);
  if (!expanded && anchor === history.length - 1) return current;
  return [
    ...(expanded ? [...current.slice(0, -1), enrich(saved, tail)] : current),
    ...history.slice(anchor + 1),
  ];
}
