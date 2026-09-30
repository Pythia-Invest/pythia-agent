import type { DynamicToolUIPart } from "ai";
import { describe, expect, it } from "vitest";
import type { DeskUIMessage } from "../src/client/chat-message";
import {
  activityTurn,
  segmentSeconds,
  splitTurn,
  steerSegments,
  toolOutcome,
} from "../src/components/chat/turn-model";
import { relativeTime } from "../src/components/chat/answer-actions";
import { toolCopy, toolView } from "../src/components/chat/tool-copy";

const pending: DynamicToolUIPart = {
  type: "dynamic-tool",
  toolCallId: "call",
  toolName: "terminal",
  input: { command: "date" },
  state: "input-available",
};

describe("transcript presentation", () => {
  it("never moves previously displayed prose into reasoning when a tool arrives", () => {
    const parts: DeskUIMessage["parts"] = [
      { type: "text", text: "I will check.", state: "done" },
    ];
    const before = splitTurn("message", parts);
    const after = splitTurn("message", [
      ...parts,
      pending,
      { type: "text", text: "Monday" },
    ]);
    expect(after.blocks[0]).toEqual(before.blocks[0]);
    expect(after.blocks.map((block) => block.kind)).toEqual([
      "text",
      "process",
      "text",
    ]);
  });

  it("keeps actual reasoning separate from assistant prose and actionable approvals", () => {
    const turn = splitTurn("m", [
      { type: "reasoning", text: "Compare two sources.", state: "done" },
      pending,
      {
        type: "data-approval",
        id: "a",
        data: { runId: "r", requestId: "a", choices: ["once", "deny"] },
      },
      {
        type: "data-approval",
        id: "b",
        data: { runId: "r", requestId: "b", choices: ["deny"] },
      },
    ]);
    expect(turn.blocks[0]).toMatchObject({
      kind: "process",
      steps: [{ kind: "reasoning" }, { kind: "tool" }],
    });
    expect(turn.approvals).toHaveLength(2);
  });

  it("does not declare a pending tool successful when the stream ends or another call starts", () => {
    expect(toolOutcome(pending, true)).toBe("running");
    expect(toolOutcome(pending, false)).toBe("unconfirmed");
    expect(
      toolOutcome(
        { ...pending, state: "output-error", errorText: "Failed" },
        false,
      ),
    ).toBe("failed");
    expect(
      toolOutcome(
        { ...pending, state: "output-available", output: "Monday" },
        false,
      ),
    ).toBe("completed");
    expect(
      toolOutcome(
        { ...pending, state: "output-available", output: '{"error":false}' },
        false,
      ),
    ).toBe("completed");
    expect(
      toolOutcome(
        {
          ...pending,
          state: "output-available",
          output: '{"error":"missing file"}',
        },
        false,
      ),
    ).toBe("failed");
  });

  it("does not treat an empty or unknown result status as a failed operation", () => {
    expect(
      toolOutcome(
        {
          ...pending,
          state: "output-available",
          output: '{"status":"empty","data":null}',
        },
        false,
      ),
    ).toBe("completed");
    expect(
      toolOutcome(
        {
          ...pending,
          state: "output-available",
          output: '{"status":"future_status","data":null}',
        },
        false,
      ),
    ).toBe("completed");
  });

  it("does not claim a memory write for a removal", () => {
    expect(
      toolCopy(
        toolView({
          ...pending,
          toolName: "memory",
          input: { action: "remove" },
        }),
      ).done,
    ).toBe("Updated notes");
  });
});

describe("live answer placement", () => {
  const message: DeskUIMessage = {
    id: "reply",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Source preview",
        providerMetadata: { pythia: { preview: true } },
      },
      pending,
      { type: "text", text: "I found a source." },
    ],
  };

  it("places streamed prose outside activity and keeps its identity through completion", () => {
    const live = activityTurn(message, true);
    const done = activityTurn(message, false);
    expect(live.prose.map((block) => block.part.text)).toEqual([
      "I found a source.",
    ]);
    expect(live.steps.map((step) => step.kind)).toEqual(["commentary", "tool"]);
    expect(live.prose).toEqual(done.prose);
    expect(live.answer).toBeUndefined();
    expect(done.answer?.text).toBe("I found a source.");
  });

  it("keeps visible prose outside activity if tools resume and archives only earlier text at completion", () => {
    const resumed: DeskUIMessage = {
      ...message,
      parts: [
        ...message.parts,
        { ...pending, toolCallId: "second" },
        { type: "text", text: "Final finding." },
      ],
    };
    const live = activityTurn(resumed, true);
    expect(live.prose.map((block) => block.part.text)).toEqual([
      "I found a source.",
      "Final finding.",
    ]);
    expect(live.prose[0]).toEqual(activityTurn(message, true).prose[0]);
    const done = activityTurn(resumed, false);
    expect(done.prose).toEqual([live.prose[1]]);
    expect(
      done.steps
        .filter((step) => step.kind === "commentary")
        .map((step) => step.part.text),
    ).toEqual(["Source preview", "I found a source."]);
  });

  it.each(["failed", "cancelled"] as const)(
    "retains partial prose when the run is %s instead of hiding it in activity",
    (state) => {
      const ended: DeskUIMessage = {
        ...message,
        parts: [...message.parts, { type: "data-run-status", data: { state } }],
      };
      expect(activityTurn(ended, false).prose).toEqual(
        activityTurn(message, true).prose,
      );
      expect(activityTurn(ended, false).answer).toBeUndefined();
    },
  );
});

describe("steered runs", () => {
  const steer = (id: string, data: { at?: number; worked?: number } = {}) =>
    ({ type: "data-steer", id, data: { text: id, ...data } }) as const;

  it("closes the work before every steer, answered or not", () => {
    const segments = steerSegments([
      pending,
      steer("s1"),
      { type: "reasoning", text: "Rechecking", state: "done" },
      steer("s2"),
      { type: "text", text: "Answer", state: "done" },
    ]);
    expect(segments.map((segment) => segment.steer?.id)).toEqual([
      undefined,
      "s1",
      "s2",
    ]);
    expect(segments.map((segment) => segment.parts.length)).toEqual([1, 1, 1]);
  });

  it("times each segment from its steers and gives the last the rest", () => {
    const segments = steerSegments([
      pending,
      steer("s1", { at: 12_000, worked: 12 }),
      pending,
      steer("s2", { at: 20_000, worked: 8 }),
    ]);
    expect(segmentSeconds(segments, 0, 30)).toEqual([12, 8, 10]);
    expect(segmentSeconds(segments, 0)).toEqual([12, 8, undefined]);
  });

  it("measures guidance not yet reported from when it was sent", () => {
    const segments = steerSegments([pending, steer("s1", { at: 7_000 })]);
    expect(segmentSeconds(segments, 1_000)).toEqual([6, undefined]);
    // Saved history predates this page: no measurement from its load time.
    expect(segmentSeconds(segments, 9_000)).toEqual([undefined, undefined]);
  });
});

describe("answer time", () => {
  const now = new Date(2026, 8, 23, 15, 0).getTime();
  it.each([
    [now - 20_000, "just now"],
    [now - 60_000, "1 minute ago"],
    [now - 5 * 60_000, "5 minutes ago"],
    [now - 3 * 60 * 60_000, "3 hours ago"],
    [new Date(2026, 8, 22, 9, 0).getTime(), "yesterday"],
    [new Date(2026, 8, 20, 9, 0).getTime(), "Sep 20"],
    [new Date(2025, 8, 20, 9, 0).getTime(), "Sep 20, 2025"],
  ])("formats %d as %s", (then, label) => {
    expect(relativeTime(then, now, "en-US")).toBe(label);
  });
});
