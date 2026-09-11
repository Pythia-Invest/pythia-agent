import type { DynamicToolUIPart } from "ai";
import { describe, expect, it } from "vitest";
import type { DeskUIMessage } from "../src/client/chat-message";
import { splitTurn, toolOutcome } from "../src/components/chat/turn-model";
import { toolLabel, toolView } from "../src/components/chat/tool-copy";

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

  it("reads deferred tool identity from stored arguments and avoids claiming a memory write", () => {
    expect(
      toolView({
        ...pending,
        toolName: "tool_call",
        input: { name: "pythia_eod_prices", arguments: { ticker: "EXAMPLE" } },
      }),
    ).toMatchObject({
      toolName: "pythia_eod_prices",
      input: { ticker: "EXAMPLE" },
    });
    expect(
      toolLabel(
        toolView({
          ...pending,
          toolName: "memory",
          input: { action: "remove" },
        }),
        false,
      ),
    ).toBe("Used memory");
  });
});
