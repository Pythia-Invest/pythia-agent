import type { DynamicToolUIPart } from "ai";
import { describe, expect, it } from "vitest";
import {
  type DeskUIMessage,
  historyToMessages,
  splitSteers,
} from "@/client/chat-message";
import { toolView } from "@/components/chat/tool-copy";
import {
  outputReportsFailure,
  toolDetail,
} from "@/components/chat/tool-detail";
import { turnAgents } from "@/components/chat/turn-work";
import { projectWork, readWork } from "@/server/work";
import { captured, capturedClient } from "./hermes-capture";

const history = captured("session-history.json").exchanges;
const formatters = captured<{
  steer_marker: string;
  untrusted_web_search_result: string;
}>("formatters.json");

async function transcript() {
  const client = capturedClient(history);
  const page = await client.listMessages("capture-session", 100, 0);
  return { rows: page.data, messages: historyToMessages(page.data) };
}

function tools(messages: DeskUIMessage[]) {
  return new Map(
    messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "dynamic-tool" ? [[part.toolCallId, part] as const] : [],
      ),
    ),
  );
}

function rowContaining(
  rows: { id: string; content?: unknown }[],
  text: string,
) {
  const row = rows.find(
    (entry) =>
      typeof entry.content === "string" && entry.content.includes(text),
  );
  if (!row) throw new Error(`No captured row contains ${text}`);
  return row.id;
}

function noteFor(messages: DeskUIMessage[], rowId: string) {
  return messages.find((message) => message.id === rowId)?.metadata?.note;
}

describe("pinned Hermes history", () => {
  it("drops the rows Hermes projects as hidden", async () => {
    const { rows, messages } = await transcript();
    const hidden = rows
      .filter((row) => row.display_kind === "hidden")
      .map((row) => row.id);
    expect(hidden).toHaveLength(2);
    const shown = messages.flatMap((message) => message.metadata?.historyRows);
    for (const id of hidden) expect(shown).not.toContain(id);
  });

  it("attaches each stored tool result to its call and detects failures", async () => {
    const { messages } = await transcript();
    const calls = tools(messages);
    const outcome = (id: string) => {
      const part = calls.get(id);
      expect(part?.state, id).toBe("output-available");
      return outputReportsFailure((part as { output?: unknown }).output);
    };
    expect(outcome("call_terminal")).toBe(true);
    expect(outcome("call_search")).toBe(true);
    expect(outcome("call_todo")).toBe(false);
    expect(outcome("call_todo_invalid")).toBe(true);
    expect(outcome("call_delegate")).toBe(true);
  });

  it("reads the deferred tool behind the tool_call bridge", async () => {
    const part = tools((await transcript()).messages).get("call_bridge");
    expect(toolView(part as DynamicToolUIPart)).toEqual({
      toolName: "pythia_eod_prices",
      input: { symbol: "ACME.US" },
    });
  });

  it("reads an untrusted-data envelope as a successful search", () => {
    const output = formatters.untrusted_web_search_result;
    expect(outputReportsFailure(output)).toBe(false);
    const part = {
      type: "dynamic-tool",
      toolCallId: "search",
      toolName: "web_search",
      input: { query: "ACME annual report" },
      state: "output-available",
      output,
    } as DynamicToolUIPart;
    expect(toolDetail(toolView(part), part, false)).toEqual({
      kind: "links",
      links: [
        {
          title: "ACME annual report",
          url: "https://example.com/acme-2025",
          site: "example.com",
        },
      ],
    });
  });

  it("turns Hermes notices into system notes, not user bubbles", async () => {
    const { rows, messages } = await transcript();
    const note = (text: string) => noteFor(messages, rowContaining(rows, text));
    expect(note("[ASYNC DELEGATION COMPLETE — deleg-capture-1]")).toBe(
      "async_delegation_complete",
    );
    expect(note("--- ✗ TASK 2/2")).toBe("async_delegation_incomplete");
    expect(note("Background process proc_capture_1 completed")).toBe(
      "internal_notification",
    );
    expect(note('matched watch pattern "ERROR"')).toBe("internal_notification");
    expect(note("2 background processes completed")).toBe(
      "internal_notification",
    );
    expect(note("2 background subagent delegations")).toBe(
      "internal_notification",
    );
    for (const message of messages)
      if (message.role === "user")
        expect(JSON.stringify(message.parts)).not.toContain(
          "[ASYNC DELEGATION",
        );
  });

  it("marks failed and truncated delegations as incomplete", async () => {
    const { rows, messages } = await transcript();
    for (const text of ["deleg-capture-2]", "--- ⚠ TASK 2/2"])
      expect(noteFor(messages, rowContaining(rows, text))).toBe(
        "async_delegation_incomplete",
      );
  });

  it("parses the pinned steer marker", () => {
    expect(splitSteers(`Result${formatters.steer_marker}`)).toEqual({
      text: "Result",
      steers: ["Focus on 2025 only."],
    });
  });

  it("keeps a saved steer inside the tool result it followed (pinned gap)", async () => {
    // The pinned Hermes never persists a steer row; Desk's saved-steer view
    // expects the `display_kind: "steer"` row Hermes v2026.9.11+ writes. Until
    // then a saved steer is only visible in the tool output it rode on.
    const { messages } = await transcript();
    const bridge = tools(messages).get("call_bridge") as { output?: string };
    expect(splitSteers(bridge.output ?? "").steers).toEqual([
      "Focus on 2025 only.",
    ]);
    const steers = messages.flatMap((message) =>
      message.parts.filter((part) => part.type === "data-steer"),
    );
    expect(steers).toEqual([]);
  });
});

describe("pinned Hermes work projection", () => {
  it("keeps the last valid plan and every delegated assignment", async () => {
    const { rows } = await transcript();
    const { plans, assignments } = projectWork(rows);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.items.map((item) => [item.id, item.status])).toEqual([
      ["filings", "completed"],
      ["margins", "in_progress"],
      ["memo", "pending"],
    ]);
    expect(assignments).toEqual([
      { goal: "Summarize the risk factors in the 2025 annual report" },
      { goal: "Compare segment margins", context: "Use the 2025 filing." },
    ]);
  });

  it("matches a listed research agent to its full delegated task", async () => {
    const client = capturedClient(history);
    const work = await readWork(
      client,
      "capture-session",
      0,
      new AbortController().signal,
    );
    const [listed] = work.agents;
    expect(listed?.goal).toMatch(/\.\.\.$/u);
    const goal =
      "Summarize the risk factors in the 2025 annual report and compare them with 2024.";
    const delegation = {
      type: "dynamic-tool",
      toolCallId: "call_delegate",
      toolName: "delegate_task",
      input: { tasks: [{ goal }] },
      state: "input-available",
    } as DynamicToolUIPart;
    const [found] = turnAgents(
      [{ kind: "tool", key: "call_delegate", part: delegation }],
      [],
      work.agents,
    );
    expect(found?.id).toBe("capture-child-session");
    // The delegation holds the full task where the listing shortened it.
    expect(found?.goal).toBe(goal);
  });
});
