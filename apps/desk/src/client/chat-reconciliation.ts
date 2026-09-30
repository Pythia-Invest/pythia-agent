import type { DeskUIMessage } from "./chat-message";
import { userText, userWorkspaceContext } from "./chat-message";

function rowIds(message: DeskUIMessage) {
  return message.metadata?.historyRows ?? [message.id];
}

function sharesRows(left: DeskUIMessage, right: DeskUIMessage) {
  const ids = new Set(rowIds(left));
  return rowIds(right).some((id) => ids.has(id));
}

/**
 * Hermes keeps mid-run guidance only in the running turn's memory, so its
 * saved transcript lacks it. Keep what the reader saw, after the same number
 * of tool calls as it arrived.
 */
function withLiveSteers(
  parts: DeskUIMessage["parts"],
  live: DeskUIMessage,
): DeskUIMessage["parts"] {
  if (parts.some((part) => part.type === "data-steer")) return parts;
  const result = [...parts];
  let tools = 0;
  for (const part of live.parts) {
    if (part.type === "dynamic-tool") tools += 1;
    if (part.type !== "data-steer") continue;
    let index = 0;
    for (let seen = 0; index < result.length && seen < tools; index += 1)
      if (result[index]?.type === "dynamic-tool") seen += 1;
    while (result[index]?.type === "data-steer") index += 1;
    result.splice(index, 0, part);
  }
  return result;
}

function enrich(saved: DeskUIMessage, live: DeskUIMessage): DeskUIMessage {
  return {
    ...saved,
    id: live.id,
    metadata: {
      ...saved.metadata,
      ...live.metadata,
      ...(saved.metadata?.run || live.metadata?.run
        ? { run: { ...saved.metadata?.run, ...live.metadata?.run } }
        : {}),
      historyRows: rowIds(saved),
    },
    parts: withLiveSteers(
      [
        ...live.parts.filter(
          (part) => part.type === "data-approval" || part.type === "data-agent",
        ),
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
      live,
    ),
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
  if (live?.id !== completedMessageId || live.metadata?.outcome !== "completed")
    return current;
  const finalText = (message: DeskUIMessage) =>
    message.parts.findLast((part) => part.type === "text")?.text ?? "";
  // Background native work can append another turn before this read completes.
  // Match the completed answer and validate its preceding user boundary below.
  for (let savedIndex = history.length - 1; savedIndex >= 0; savedIndex -= 1) {
    const saved = history[savedIndex];
    if (saved?.role !== "assistant" || finalText(saved) !== finalText(live))
      continue;

    // A reload may hydrate the persisted answer before recovering its terminal
    // run status. Identify that adjacent copy by native rows, never answer text.
    const previous = current.at(-2);
    if (previous?.role === "assistant" && sharesRows(previous, saved)) {
      return [...current.slice(0, -2), enrich(enrich(saved, previous), live)];
    }
    const users = current.filter((message) => message.role === "user");
    const savedUsers = history
      .slice(0, savedIndex)
      .filter((message) => message.role === "user");
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
          JSON.stringify(userWorkspaceContext(message)?.references ?? []) !==
            JSON.stringify(userWorkspaceContext(savedUser)?.references ?? []) ||
          JSON.stringify(files(message)) !== JSON.stringify(files(savedUser))
        );
      })
    )
      continue;
    // Native history owns arguments and results; retain run-only approvals and
    // earlier failures that Hermes does not persist as transcript rows.
    return [...current.slice(0, -1), enrich(saved, live)];
  }
  return current;
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
