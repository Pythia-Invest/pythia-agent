import type {
  DataUIPart,
  DynamicToolUIPart,
  ReasoningUIPart,
  TextUIPart,
} from "ai";
import type { DeskDataParts, DeskUIMessage } from "@/client/chat-message";
import { outputReportsFailure } from "./tool-copy";

type Part = DeskUIMessage["parts"][number];
type ApprovalPart = DataUIPart<DeskDataParts> & { type: "data-approval" };
type StatusPart = DataUIPart<DeskDataParts> & { type: "data-run-status" };
type SteerPart = DataUIPart<DeskDataParts> & { type: "data-steer" };

export type ProcessStep =
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
