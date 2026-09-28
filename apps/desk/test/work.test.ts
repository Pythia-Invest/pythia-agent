import { describe, expect, it, vi } from "vitest";
import { agentStatus, projectWork, readAgent, readWork } from "@/server/work";
import { workState, planRows, mergeObservedWork } from "@/client/work-state";
import { RunEventMapper } from "@/client/hermes-run-mapper";
import { activityTurn } from "@/components/chat/turn-model";
import type { DeskUIMessage } from "@/client/chat-message";
import type { HermesClient, HermesMessage } from "@/server/types";
import type { WorkPage } from "@/work/types";

// Synthetic shapes from pinned tools/todo_tool.py:todo_tool and api_server.py session/message responses.
const task = (
  id: string,
  status: "pending" | "completed" | "in_progress" = "pending",
) => ({ id, content: `Task ${id}`, status });
const snapshot = (
  id: string,
  todos: ReturnType<typeof task>[],
): HermesMessage => ({
  id,
  role: "tool",
  tool_name: "todo",
  content: JSON.stringify({ todos, revision: Number(id) }),
});
const page = (plans: WorkPage["plans"]): WorkPage => ({
  plans,
  agents: [],
  assignments: [],
  offset: 0,
  historyMore: false,
  agentsMore: false,
});

describe("native work projection", () => {
  it("keeps the plan outside the recent window but honors a later clear", () => {
    const previous = page(projectWork([snapshot("1", [task("a")])]).plans);
    const shifted = mergeObservedWork(previous, page([]));
    expect(workState([shifted], [], false).plan?.items).toEqual([task("a")]);
    const cleared = mergeObservedWork(
      shifted,
      page(projectWork([snapshot("2", [])]).plans),
    );
    expect(workState([cleared], [], false).plan?.items).toEqual([]);
  });
  it("accepts an explicit empty list, ignores failed and malformed writes", () => {
    const result = projectWork([
      snapshot("1", [task("a")]),
      {
        id: "bad",
        role: "tool",
        tool_name: "todo",
        content: '{"todos":[],"error":"write failed"}',
      },
      {
        id: "bad2",
        role: "tool",
        tool_name: "todo",
        content: '{"todos":[{"id":"a","status":"made_up"}]}',
      },
      snapshot("2", []),
    ]);
    expect(result.plans.map((p) => p.id)).toEqual(["1", "2"]);
    expect(workState([page(result.plans)], [], false)).toMatchObject({
      plan: { items: [] },
      removed: [task("a")],
    });
  });

  it("keeps completed, cancelled and removed distinct and restores native order across pages", () => {
    const older = page(
      projectWork([snapshot("1", [task("a"), task("b")])]).plans,
    );
    const latest = page(
      projectWork([snapshot("2", [task("a", "completed")])]).plans,
    );
    const state = workState([latest, older], [], false);
    expect(state.plan?.items).toEqual([task("a", "completed")]);
    expect(state.removed).toEqual([task("b")]);
    const returned = page(projectWork([snapshot("3", [task("b")])]).plans);
    expect(
      workState([returned, latest, older], [], false).removed.map((t) => t.id),
    ).toEqual(["a"]);
  });

  it.each([undefined, "spawn"])(
    "matches tool results and retains context for action %s",
    (action) => {
      const result = projectWork([
        {
          id: "a",
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "t", function: { name: "todo", arguments: "{}" } },
            {
              id: "d",
              function: {
                name: "delegate_task",
                arguments: JSON.stringify({
                  action,
                  tasks: [
                    {
                      goal: "Verify source dates",
                      context: "Use primary sources",
                    },
                  ],
                }),
              },
            },
          ],
        },
        { ...snapshot("1", [task("a")]), tool_name: null, tool_call_id: "t" },
      ]);
      expect(result.plans[0]?.items).toEqual([task("a")]);
      expect(result.assignments).toEqual([
        { goal: "Verify source dates", context: "Use primary sources" },
      ]);
    },
  );

  it("does not treat delegation controls as new assignments", () => {
    const result = projectWork([
      {
        id: "controls",
        role: "assistant",
        content: "",
        tool_calls: ["list", "steer", "stop"].map((action) => ({
          id: action,
          function: {
            name: "delegate_task",
            arguments: JSON.stringify({
              action,
              goal: "Not an assignment",
              context: "Not initial context",
            }),
          },
        })),
      },
    ]);
    expect(result.assignments).toEqual([]);
  });

  it("retains every task even with cyclic or missing parents", () => {
    const rows = planRows([
      { ...task("a"), parent: "b" },
      { ...task("b"), parent: "a" },
      { ...task("c"), parent: "missing" },
    ]);
    expect(new Set(rows.map((r) => r.item.id))).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(rows).toHaveLength(3);
  });

  it("reads bounded pages and excludes unrelated and non-agent children", async () => {
    const client = {
      listMessages: vi.fn(async () => ({ data: [], returned: 200 })),
      listSessions: vi.fn(async () => [
        {
          id: "child",
          source: "subagent",
          parent_session_id: "parent",
          ended_at: 10,
          title: "Source coverage",
        },
        { id: "other", source: "subagent", parent_session_id: "elsewhere" },
        { id: "branch", source: "api_server", parent_session_id: "parent" },
      ]),
    } as unknown as HermesClient;
    const signal = new AbortController().signal;
    const result = await readWork(client, "parent", 200, signal);
    expect(client.listMessages).toHaveBeenCalledWith("parent", 200, 200, {
      signal,
    });
    expect(client.listSessions).toHaveBeenCalledWith(200, 200, {
      includeChildren: true,
      source: "subagent",
      signal,
    });
    expect(result.agents).toEqual([
      {
        id: "child",
        sessionId: "child",
        goal: "Research agent",
        title: "Source coverage",
        status: "ended",
      },
    ]);
    expect(result.historyMore).toBe(true);
  });

  it("reads an unended child as working while Hermes shows its activity", () => {
    const now = 10_000;
    expect(agentStatus({ ended_at: 9_000, last_active: 9_999 }, now)).toBe(
      "ended",
    );
    expect(agentStatus({ last_active: now - 60 }, now)).toBe("running");
    expect(agentStatus({ last_active: now - 1_200 }, now)).toBe("running");
    // Past Hermes's own stall threshold, working and abandoned look alike.
    expect(agentStatus({ last_active: now - 1_201 }, now)).toBe("unknown");
    expect(agentStatus({}, now)).toBe("unknown");
  });

  it("lets the saved session speak once a child's start event is stale", () => {
    const page = (status: "running" | "ended" | "unknown"): WorkPage => ({
      plans: [],
      assignments: [],
      offset: 0,
      historyMore: false,
      agentsMore: false,
      agents: [{ id: "child", sessionId: "child", goal: "Check", status }],
    });
    const started: DeskUIMessage[] = [
      {
        id: "turn",
        role: "assistant",
        parts: [
          {
            type: "data-agent",
            id: "agent:child",
            data: { id: "child", goal: "Check", status: "running" },
          },
        ],
      },
    ];
    const status = (saved: "running" | "ended" | "unknown", busy: boolean) =>
      workState([page(saved)], started, busy).agents[0]?.status;
    // A background child keeps working after the parent's run has ended.
    expect(status("running", false)).toBe("running");
    expect(status("ended", false)).toBe("ended");
    expect(status("unknown", false)).toBe("unknown");
    expect(status("unknown", true)).toBe("running");
    expect(workState([], started, false).agents[0]?.status).toBe("unknown");
  });

  it("rejects an unrelated child before reading any transcript", async () => {
    const client = {
      getSession: vi.fn(async () => ({
        id: "child",
        source: "subagent",
        parent_session_id: "other",
      })),
      listMessages: vi.fn(),
    } as unknown as HermesClient;
    await expect(
      readAgent(client, "parent", "child", 0, new AbortController().signal),
    ).rejects.toMatchObject({ status: 404 });
    expect(client.listMessages).not.toHaveBeenCalled();
  });

  it("reads the original assignment and recent child activity through native pagination", async () => {
    const client = {
      getSession: vi.fn(async () => ({
        id: "child",
        source: "subagent",
        parent_session_id: "parent",
      })),
      listMessages: vi.fn<HermesClient["listMessages"]>(
        async (_id, limit, offset, options) => ({
          limit,
          offset,
          returned: 1,
          data:
            options?.order === "oldest"
              ? [
                  {
                    id: "assignment",
                    role: "user",
                    content: "Verify source coverage",
                  },
                ]
              : [
                  {
                    id: "activity",
                    role: "assistant",
                    content: "Checking the sources.",
                  },
                ],
        }),
      ),
    } satisfies Pick<HermesClient, "getSession" | "listMessages">;
    const signal = new AbortController().signal;
    const detail = await readAgent(
      client as unknown as HermesClient,
      "parent",
      "child",
      100,
      signal,
    );
    expect(detail).toMatchObject({
      assignment: "Verify source coverage",
      assignmentId: "assignment",
      ended: false,
      offset: 100,
      more: false,
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Checking the sources." }],
        },
      ],
    });
    expect(client.listMessages).toHaveBeenCalledWith("child", 20, 0, {
      order: "oldest",
      signal,
    });
    expect(client.listMessages).toHaveBeenCalledWith("child", 100, 100, {
      signal,
    });
  });
});

describe("live activity", () => {
  it("keeps child completion after its launching tool has returned", () => {
    const mapper = new RunEventMapper("run");
    mapper.map({ event: "tool.started", tool: "delegate_task" });
    mapper.map({
      event: "subagent.start",
      child_session_id: "child",
      goal: "Verify source dates",
    });
    mapper.map({ event: "tool.completed", tool: "delegate_task" });
    const chunks = mapper.map({
      event: "subagent.complete",
      child_session_id: "child",
      status: "completed",
      summary: "Dates verified",
    });
    expect(chunks).toContainEqual({
      type: "data-agent",
      id: "agent:child",
      data: {
        id: "child",
        sessionId: "child",
        goal: "Verify source dates",
        status: "completed",
        summary: "Dates verified",
      },
    });
  });

  it("does not turn parent completion into child completion", () => {
    const messages: DeskUIMessage[] = [
      {
        id: "run",
        role: "assistant",
        parts: [
          {
            type: "data-agent",
            data: { id: "child", goal: "Verify", status: "running" },
          },
        ],
      },
    ];
    expect(workState([], messages, true).agents[0]?.status).toBe("running");
    expect(workState([], messages, false).agents[0]?.status).toBe("unknown");
  });

  it("keeps live prose separate and archives earlier commentary after completion", () => {
    const message: DeskUIMessage = {
      id: "run",
      role: "assistant",
      parts: [
        { type: "text", text: "Checking the sources." },
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "tool",
          input: {},
          state: "output-available",
          output: "",
        },
        { type: "text", text: "The result.", state: "streaming" },
      ],
    };
    expect(activityTurn(message, true).steps.map((s) => s.kind)).toEqual([
      "tool",
    ]);
    expect(
      activityTurn(message, true).prose.map((block) => block.part.text),
    ).toEqual(["Checking the sources.", "The result."]);
    expect(activityTurn(message, true).answer).toBeUndefined();
    expect(activityTurn(message, false).answer?.text).toBe("The result.");
    expect(activityTurn(message, false).steps).toHaveLength(2);
    message.parts.push({
      type: "data-run-status",
      data: { state: "cancelled" },
    });
    expect(activityTurn(message, false).answer).toBeUndefined();
  });
});
