import { describe, expect, it } from "vitest";
import {
  historyToMessages,
  messageText,
  userText,
} from "../src/client/chat-message";
import type { HermesMessage } from "../src/server/types";

describe("history to UI messages", () => {
  it("folds assistant text, tool calls and tool results into one assistant turn", () => {
    const history: HermesMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "Compare ASML and Lam",
        timestamp: 1_699_999_998,
      },
      {
        id: "a1",
        role: "assistant",
        content: "",
        reasoning: "Compare capex sensitivity.",
        timestamp: 1_700_000_000,
        tool_calls: [
          {
            id: "call-1",
            function: { name: "sec_filings", arguments: '{"ticker":"ASML"}' },
          },
        ],
      },
      {
        id: "t1",
        role: "tool",
        content: "10-K summary",
        tool_call_id: "call-1",
        timestamp: 1_700_000_003.4,
      },
      { id: "a2", role: "assistant", content: "ASML leads on EUV." },
      { id: "u2", role: "user", content: [{ type: "text", text: "Thanks" }] },
    ];
    const messages = historyToMessages(history);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1]?.parts).toEqual([
      {
        type: "reasoning",
        text: "Compare capex sensitivity.",
        state: "done",
      },
      {
        type: "dynamic-tool",
        toolCallId: "call-1",
        toolName: "sec_filings",
        input: { ticker: "ASML" },
        state: "output-available",
        output: "10-K summary",
      },
      { type: "text", text: "ASML leads on EUV.", state: "done" },
    ]);
    const last = messages[2];
    expect(last && userText(last)).toBe("Thanks");
  });

  it("keeps commentary as text and does not infer reasoning duration from timestamps", () => {
    const messages = historyToMessages([
      { id: "u", role: "user", content: "What day is it?", timestamp: 100 },
      {
        id: "a1",
        role: "assistant",
        content: "Let me check.",
        timestamp: 103,
        tool_calls: [
          { id: "c1", function: { name: "terminal", arguments: "{}" } },
        ],
      },
      {
        id: "t1",
        role: "tool",
        content: "Monday",
        tool_call_id: "c1",
        timestamp: 104,
      },
      { id: "a2", role: "assistant", content: "It is Monday.", timestamp: 106 },
    ]);
    const parts = messages[1]?.parts ?? [];
    expect(parts.map((p) => p.type)).toEqual(["text", "dynamic-tool", "text"]);
    expect(parts[0]).toMatchObject({
      text: "Let me check.",
    });
    expect(parts[0]).not.toHaveProperty("providerMetadata");
    expect(parts[2]).toMatchObject({ type: "text", text: "It is Monday." });
  });

  it("drops empty user rows, system rows and tool results without a caller", () => {
    const messages = historyToMessages([
      { id: "s", role: "system", content: "You are Pythia." },
      { id: "u", role: "user", content: "" },
      { id: "t", role: "tool", content: "orphan", tool_call_id: "missing" },
      { id: "a", role: "assistant", content: "Hello" },
    ]);
    expect(messages).toEqual([
      {
        id: "a",
        role: "assistant",
        metadata: { historyRows: ["a"] },
        parts: [{ type: "text", text: "Hello", state: "done" }],
      },
    ]);
  });

  it("renders unknown content shapes as readable text", () => {
    expect(messageText("plain")).toBe("plain");
    expect(messageText([{ type: "text", text: "a" }, "b"])).toBe("a\nb");
    expect(messageText({ nested: true })).toContain('"nested": true');
    expect(messageText(null)).toBe("");
  });
});
