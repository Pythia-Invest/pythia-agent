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
      { id: "u1", role: "user", content: "Compare ASML and Lam" },
      {
        id: "a1",
        role: "assistant",
        content: "",
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
      },
      { id: "a2", role: "assistant", content: "ASML leads on EUV." },
      { id: "u2", role: "user", content: [{ type: "text", text: "Thanks" }] },
    ];
    const messages = historyToMessages(history);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[1]?.parts).toEqual([
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
