import type {
  DataUIPart,
  DynamicToolUIPart,
  ReasoningUIPart,
  TextUIPart,
} from "ai";
import type { DeskDataParts, DeskUIMessage } from "@/client/chat-message";
import { outputReportsFailure } from "./tool-detail";

type Part = DeskUIMessage["parts"][number];
type ApprovalPart = DataUIPart<DeskDataParts> & { type: "data-approval" };
type StatusPart = DataUIPart<DeskDataParts> & { type: "data-run-status" };
export type SteerPart = DataUIPart<DeskDataParts> & { type: "data-steer" };

export type ProcessStep =
  | { kind: "commentary"; key: string; part: TextUIPart }
  | { kind: "reasoning"; key: string; part: ReasoningUIPart }
  | { kind: "tool"; key: string; part: DynamicToolUIPart }
  | { kind: "approval"; key: string; part: ApprovalPart };

export type TurnBlock =
  | { kind: "text"; key: string; part: TextUIPart }
  | { kind: "steer"; key: string; part: SteerPart }
  | { kind: "process"; key: string; steps: ProcessStep[] };

/** Preserve the transcript's order. Only actual reasoning belongs in reasoning
 * disclosures; a later tool must never move already visible assistant prose. */
export function splitTurn(messageId: string, parts: readonly Part[]) {
  const blocks: TurnBlock[] = [];
  const approvals: ApprovalPart[] = [];
  const status: StatusPart[] = [];

  const addStep = (step: ProcessStep) => {
    const last = blocks.at(-1);
    if (last?.kind === "process") last.steps.push(step);
    else
      blocks.push({
        kind: "process",
        key: `${messageId}:process:${blocks.filter((block) => block.kind === "process").length}`,
        steps: [step],
      });
  };

  parts.forEach((part, index) => {
    const key = `${messageId}:${index}`;
    switch (part.type) {
      case "text":
        if (part.text.trim()) blocks.push({ kind: "text", key, part });
        break;
      case "reasoning":
        if (part.text.trim()) addStep({ kind: "reasoning", key, part });
        break;
      case "dynamic-tool":
        addStep({ kind: "tool", key: part.toolCallId, part });
        break;
      case "data-approval":
        if (part.data.responded === undefined) approvals.push(part);
        else addStep({ kind: "approval", key, part });
        break;
      case "data-run-status":
        status.push(part);
        break;
      case "data-steer":
        blocks.push({ kind: "steer", key, part });
        break;
      default:
        break;
    }
  });
  return { blocks, approvals, status };
}

export function toolPending(part: DynamicToolUIPart) {
  return part.state === "input-streaming" || part.state === "input-available";
}

export type ToolOutcome = "running" | "completed" | "failed" | "unconfirmed";

/** A stopped stream is not proof of a tool's success or its cancellation. */
export function toolOutcome(
  part: DynamicToolUIPart,
  runActive: boolean,
): ToolOutcome {
  if (toolPending(part)) return runActive ? "running" : "unconfirmed";
  if (part.state === "output-error" || part.state === "output-denied")
    return "failed";
  if (part.state === "output-available") {
    return outputReportsFailure(part.output) ? "failed" : "completed";
  }
  return "unconfirmed";
}

export function toolParts(steps: readonly ProcessStep[]) {
  return steps.flatMap((step) => (step.kind === "tool" ? [step.part] : []));
}

/** Prose has a stable reading surface from its first token. Early presentation
 * is not evidence of a final answer: tools may still resume. */
export function activityTurn(message: DeskUIMessage, streaming: boolean) {
  const turn = splitTurn(message.id, message.parts);
  const lastProcess = turn.blocks.findLastIndex(
    (block) => block.kind === "process",
  );
  const answerIndex =
    !streaming && !turn.status.length
      ? turn.blocks.findLastIndex(
          (block, index) =>
            block.kind === "text" &&
            index > lastProcess &&
            block.part.providerMetadata?.pythia?.preview !== true,
        )
      : -1;
  const answer = turn.blocks[answerIndex];
  const prose = turn.blocks.filter(
    (block, index): block is Extract<TurnBlock, { kind: "text" }> =>
      block.kind === "text" &&
      block.part.providerMetadata?.pythia?.preview !== true &&
      (streaming || turn.status.length > 0 || index === answerIndex),
  );
  const visibleKeys = new Set(prose.map((block) => block.key));
  const steps = turn.blocks.flatMap((block): ProcessStep[] =>
    block.kind === "process"
      ? block.steps
      : block.kind === "text" && !visibleKeys.has(block.key)
        ? [{ kind: "commentary", key: block.key, part: block.part }]
        : [],
  );
  return {
    ...turn,
    steps,
    prose,
    answer: answer?.kind === "text" ? answer.part : undefined,
  };
}

/** A run's work between steers, opened by the steer that ended the one before. */
export type SteerSegment = { steer?: SteerPart; parts: Part[] };

/**
 * Splits one run where the user steered it, so what the model did before and
 * after each piece of guidance reads as it happened.
 */
export function steerSegments(parts: readonly Part[]): SteerSegment[] {
  const segments: SteerSegment[] = [{ parts: [] }];
  for (const part of parts) {
    if (part.type === "data-steer") segments.push({ steer: part, parts: [] });
    else segments.at(-1)?.parts.push(part);
  }
  return segments;
}

/**
 * Seconds each segment worked. A steer reports the time since the previous
 * boundary; guidance not yet reported is measured from when it was sent. The
 * last segment of a finished run has the rest of the run's total.
 */
export function segmentSeconds(
  segments: readonly SteerSegment[],
  turnStartedAt: number,
  total?: number,
): (number | undefined)[] {
  let start: number | undefined = turnStartedAt > 0 ? turnStartedAt : undefined;
  const closed = segments.slice(1).map(({ steer }) => {
    const at = steer?.data.at;
    const seconds =
      steer?.data.worked ??
      (at !== undefined && start !== undefined && at > start
        ? (at - start) / 1000
        : undefined);
    start = at;
    return seconds;
  });
  const rest =
    total === undefined
      ? undefined
      : total -
        closed.reduce<number>((sum, seconds) => sum + (seconds ?? 0), 0);
  return [...closed, rest !== undefined && rest > 0 ? rest : undefined];
}
