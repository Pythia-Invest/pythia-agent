import { describe, expect, it } from "vitest";
import {
  historyToMessages,
  type DeskUIMessage,
} from "../src/client/chat-message";
import {
  appendHistory,
  prependHistory,
  reconcileCompletedHistory,
} from "../src/client/chat-reconciliation";

const user: DeskUIMessage = {
  id: "optimistic-user",
  role: "user",
  parts: [{ type: "text", text: "Check the example." }],
};
const live: DeskUIMessage = {
  id: "run",
  role: "assistant",
  metadata: { outcome: "completed" },
  parts: [
    {
      type: "data-approval",
      data: {
        runId: "run",
        requestId: "approval",
        choices: [],
        responded: "once",
        command: "date",
      },
    },
    { type: "text", text: "Done" },
  ],
};
const saved: [DeskUIMessage, DeskUIMessage] = [
  { ...user, id: "native-user" },
  {
    id: "native-assistant",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolCallId: "native-call",
        toolName: "terminal",
        input: { command: "date" },
        state: "output-available",
        output: "Monday",
      },
      { type: "text", text: "Done" },
    ],
  },
];

describe("completed history reconciliation", () => {
  it("enriches the completed reply while preserving observed approval decisions", () => {
    const result = reconcileCompletedHistory([user, live], saved, "run");
    expect(result[1]?.parts).toEqual([live.parts[0], ...saved[1].parts]);
    expect(result[1]?.id).toBe("run");
  });

  it("preserves earlier failure notes when a later turn completes", () => {
    const failed: DeskUIMessage = {
      id: "failed",
      role: "assistant",
      parts: [{ type: "data-run-status", data: { state: "failed" } }],
    };
    const current = [user, failed, user, live];
    const history = [saved[0], { ...failed, parts: [] }, ...saved];
    const result = reconcileCompletedHistory(current, history, "run");
    expect(result[1]).toBe(failed);
  });

  it("enriches the newest turn even after older pages have been loaded", () => {
    const older = {
      ...user,
      id: "older",
      parts: [{ type: "text" as const, text: "Earlier question" }],
    };
    const anchor = { ...user, id: "native-anchor" };
    const result = reconcileCompletedHistory(
      [older, anchor, user, live],
      [anchor, ...saved],
      "run",
    );
    expect(result[0]).toBe(older);
    expect(result[3]?.parts).toEqual([live.parts[0], ...saved[1].parts]);
  });

  it("does not overwrite a new prompt, even if its text repeats an earlier prompt", () => {
    const current = [user, live, { ...user, id: "next" }];
    expect(reconcileCompletedHistory(current, saved, "run")).toBe(current);
    const next = [...current, { ...live, id: "next-run" }];
    expect(reconcileCompletedHistory(next, saved, "next-run")).toBe(next);
  });

  it("rejects incomplete history and keeps failed or disconnected messages intact", () => {
    const current = [user, live];
    expect(reconcileCompletedHistory(current, [saved[0]], "run")).toBe(current);
    const stale: DeskUIMessage[] = [
      saved[0],
      { ...saved[1], parts: [{ type: "text", text: "Partial" }] },
    ];
    expect(reconcileCompletedHistory(current, stale, "run")).toBe(current);
    const failed = [user, { ...live, metadata: {} }];
    expect(reconcileCompletedHistory(failed, saved, "run")).toBe(failed);
  });
});

describe("older history", () => {
  it("prepends an overlapping page once without replacing live messages", () => {
    const older = { ...user, id: "older" };
    const current = [saved[0], live];
    const page = [older, ...saved];
    const result = prependHistory(current, page);
    expect(result).toEqual([older, saved[0], live]);
    expect(prependHistory(result, page)).toBe(result);
    expect(prependHistory(current, [older])).toBe(current);
  });
});

describe("native transcript boundaries", () => {
  const rows = [
    { id: "u", role: "user", content: "Check" },
    {
      id: "a1",
      role: "assistant",
      content: "Checking",
      tool_calls: [
        {
          id: "call",
          function: { name: "terminal", arguments: '{"command":"date"}' },
        },
      ],
    },
    { id: "tool", role: "tool", tool_call_id: "call", content: "Monday" },
    { id: "a2", role: "assistant", content: "Done" },
  ];

  it("merges terminal recovery with the answer already hydrated from native history", () => {
    const history = historyToMessages(rows);
    const result = reconcileCompletedHistory(
      [...history, live],
      history,
      "run",
    );
    expect(result).toHaveLength(2);
    expect(result[1]?.parts).toEqual([
      live.parts[0],
      ...(history[1]?.parts ?? []),
    ]);
    expect(result[1]?.metadata?.historyRows).toEqual(["a1", "tool", "a2"]);
  });

  it("does not deduplicate an earlier answer just because the next answer repeats it", () => {
    const history = historyToMessages(rows);
    const next = { ...user, id: "next-user" };
    const result = reconcileCompletedHistory(
      [...history, next, live],
      history,
      "run",
    );
    expect(result).toHaveLength(4);
  });

  it.each([false, true])(
    "completes a split assistant turn with a later user present: %s",
    (laterUser) => {
      const transcript = laterUser
        ? [...rows, { id: "later", role: "user", content: "More" }]
        : rows;
      const partial = historyToMessages(transcript.slice(2));
      const history = historyToMessages(transcript);
      const current = [...partial, live];
      const result = prependHistory(current, history);
      expect(result.slice(0, -1)).toEqual(history);
      expect(result.at(-1)).toBe(live);
      expect(prependHistory(result, history)).toBe(result);
    },
  );
});

describe("newer native history", () => {
  const nextUser = { ...saved[0], id: "next-user" };
  const nextAnswer = { ...saved[1], id: "next-answer" };
  const history = [...saved, nextUser, nextAnswer];

  it("appends external turns after a native row anchor and only once", () => {
    const older = { ...saved[0], id: "older-page" };
    const enriched = reconcileCompletedHistory([user, live], saved, live.id);
    const current = [older, ...enriched];
    const result = appendHistory(current, history);
    expect(result).toEqual([...current, nextUser, nextAnswer]);
    expect(appendHistory(result, history)).toBe(result);
    expect(result[2]?.parts[0]).toEqual(live.parts[0]);
  });

  it("refreshes an unfinished native assistant turn when its rows expand", () => {
    const rows = [
      { id: "u", role: "user", content: "Check" },
      {
        id: "a1",
        role: "assistant",
        content: "Checking",
        tool_calls: [
          { id: "call", function: { name: "terminal", arguments: "{}" } },
        ],
      },
    ];
    const initial = historyToMessages(rows);
    const partial = initial.at(-1);
    if (!partial) throw new Error("Missing assistant fixture");
    const approval = live.parts[0];
    if (approval) partial.parts.unshift(approval);
    const history = historyToMessages([
      ...rows,
      { id: "t1", role: "tool", tool_call_id: "call", content: "Result" },
      { id: "a2", role: "assistant", content: "Finished" },
    ]);
    const result = appendHistory(initial, history);
    expect(result.at(-1)?.metadata?.historyRows).toEqual(["a1", "t1", "a2"]);
    expect(result.at(-1)?.parts).toEqual([
      live.parts[0],
      ...(history.at(-1)?.parts ?? []),
    ]);
    expect(appendHistory(result, history)).toBe(result);
  });

  it("preserves unpersisted local tails and rejects history with no anchor", () => {
    const pending = [...saved, { ...user, id: "pending" }];
    expect(appendHistory(pending, history)).toBe(pending);
    expect(appendHistory(saved, [nextUser, nextAnswer])).toBe(saved);
  });
});
