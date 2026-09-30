import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { DeskApi } from "../src/client/api";
import type { DeskUIMessage } from "../src/client/chat-message";
import { reconcileCompletedHistory } from "../src/client/chat-reconciliation";
import { refreshMessages } from "../src/client/query-cache";
import type { HermesMessage } from "../src/server/types";

// Native latest-order pages contain chronological rows within each page.
const rows: HermesMessage[] = [
  { id: "user", role: "user", content: "Research" },
  ...Array.from({ length: 60 }, (_, index) => [
    {
      id: `assistant-${index}`,
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `call-${index}`,
          function: { name: "web_search", arguments: "{}" },
        },
      ],
    },
    {
      id: `tool-${index}`,
      role: "tool",
      tool_call_id: `call-${index}`,
      content: "Result",
    },
  ]).flat(),
  { id: "answer", role: "assistant", content: "Done" },
];

describe("completion history reads", () => {
  it("reads back through a long turn to its user boundary and restores tool results", async () => {
    const client = new QueryClient();
    const api = new DeskApi();
    const read = vi
      .spyOn(api, "listMessages")
      .mockImplementation(async (_session, limit = 100, offset = 0) => {
        const end = rows.length - offset;
        const data = rows.slice(Math.max(0, end - limit), end);
        return { data, limit, offset, returned: data.length };
      });
    const current: DeskUIMessage[] = [
      {
        id: "optimistic",
        role: "user",
        parts: [{ type: "text", text: "Research" }],
      },
      {
        id: "run",
        role: "assistant",
        metadata: { outcome: "completed" },
        parts: [{ type: "text", text: "Done" }],
      },
    ];
    const history = await refreshMessages(
      client,
      api,
      "session",
      (saved) => reconcileCompletedHistory(current, saved, "run") !== current,
    );
    expect(read.mock.calls.map((call) => call[2])).toEqual([0, 100]);
    const result = reconcileCompletedHistory(current, history, "run");
    const tools = result[1]?.parts.filter(
      (part) => part.type === "dynamic-tool",
    );
    expect(tools).toHaveLength(60);
    expect(tools?.every((part) => part.state === "output-available")).toBe(
      true,
    );
    client.clear();
  });

  it("deduplicates overlapping rows if new native work shifts the offset", async () => {
    const api = new DeskApi();
    vi.spyOn(api, "listMessages")
      .mockResolvedValueOnce({
        data: rows.slice(-100),
        returned: 100,
        limit: 100,
        offset: 0,
      })
      .mockResolvedValueOnce({
        data: rows.slice(0, 25),
        returned: 25,
        limit: 100,
        offset: 100,
      });
    const client = new QueryClient();
    const history = await refreshMessages(client, api, "session", () => false);
    const ids = history.flatMap(
      (message) => message.metadata?.historyRows ?? [message.id],
    );
    expect(ids).toEqual(rows.map((row) => row.id));
    client.clear();
  });

  it("bounds reads when the matching turn cannot be found", async () => {
    const api = new DeskApi();
    const read = vi.spyOn(api, "listMessages").mockResolvedValue({
      data: rows.slice(-100),
      returned: 100,
      limit: 100,
      offset: 0,
    });
    const client = new QueryClient();
    await refreshMessages(client, api, "session", () => false);
    expect(read).toHaveBeenCalledTimes(10);
    client.clear();
  });
});
