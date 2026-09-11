import type { UIMessageChunk } from "ai";
import type { DeskRunEvent } from "@/server/types";
import type { DeskDataParts } from "./chat-message";

type DeskChunk = UIMessageChunk<unknown, DeskDataParts>;

/** Delegated task details attached to the parent native tool call. */
export class RunDelegations {
  readonly #tasks = new Map<string, Array<Record<string, unknown>>>();
  start(event: DeskRunEvent, toolCallId: string): DeskChunk[] {
    const out: DeskChunk[] = [];
    const tasks = this.#tasks.get(toolCallId) ?? [];
    const identity =
      event.child_session_id ??
      event.subagent_id ??
      String(event.task_index ?? tasks.length);
    tasks.push({
      id: identity,
      goal: event.goal ?? event.preview ?? "Delegated research",
      status: "running",
      ...(event.model ? { model: event.model } : {}),
    });
    this.#tasks.set(toolCallId, tasks);
    out.push({
      type: "tool-input-available",
      toolCallId: toolCallId,
      toolName: "delegate_task",
      input: {
        tasks,
        taskCount: event.task_count ?? tasks.length,
        preview:
          tasks.length === 1
            ? String(tasks[0]?.goal ?? "")
            : `${event.task_count ?? tasks.length} research tasks`,
      },
      dynamic: true,
    });
    return out;
  }
  complete(event: DeskRunEvent, toolCallId: string): DeskChunk[] {
    const out: DeskChunk[] = [];
    const tasks = this.#tasks.get(toolCallId) ?? [];
    const identity = event.child_session_id ?? event.subagent_id;
    const task = tasks.find((entry) => identity && entry.id === identity) ??
      tasks.find((entry) => entry.status === "running") ?? {
        id: identity ?? String(tasks.length),
        goal: event.goal ?? "Delegated research",
      };
    if (!tasks.includes(task)) tasks.push(task);
    Object.assign(task, {
      status: event.status ?? "completed",
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.duration_seconds !== undefined
        ? { durationSeconds: event.duration_seconds }
        : {}),
      ...(event.model ? { model: event.model } : {}),
      ...(event.tool_count !== undefined
        ? { toolCount: event.tool_count }
        : {}),
      ...(event.input_tokens !== undefined
        ? { inputTokens: event.input_tokens }
        : {}),
      ...(event.output_tokens !== undefined
        ? { outputTokens: event.output_tokens }
        : {}),
      ...(event.reasoning_tokens !== undefined
        ? { reasoningTokens: event.reasoning_tokens }
        : {}),
      ...(event.api_calls !== undefined ? { apiCalls: event.api_calls } : {}),
      ...(event.cost_usd !== undefined ? { costUsd: event.cost_usd } : {}),
      ...(event.files_read ? { filesRead: event.files_read } : {}),
      ...(event.files_written ? { filesWritten: event.files_written } : {}),
    });
    this.#tasks.set(toolCallId, tasks);
    out.push({
      type: "tool-input-available",
      toolCallId: toolCallId,
      toolName: "delegate_task",
      input: {
        tasks,
        taskCount: tasks.length,
        preview: `${tasks.length} research ${tasks.length === 1 ? "task" : "tasks"}`,
      },
      dynamic: true,
    });
    return out;
  }
}
