import { readUIMessageStream, type UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import type { DeskUIMessage } from "../src/client/chat-message";
import { RunEventMapper } from "../src/client/hermes-run-mapper";
import type { DeskRunEvent } from "../src/server/types";

// Native contract: pinned gateway/platforms/api_server_runs.py callbacks and
// agent/conversation_loop.py's 500-character assistant-content preview.
async function consume(
  events: DeskRunEvent[],
  terminalStatus?: Parameters<RunEventMapper["disconnected"]>[0],
  selection?: ConstructorParameters<typeof RunEventMapper>[1],
) {
  const mapper = new RunEventMapper("run-1", selection);
  const chunks = [
    ...mapper.start(),
    ...events.flatMap((event) => mapper.map(event)),
  ];
  if (terminalStatus !== undefined)
    chunks.push(...mapper.disconnected(terminalStatus));
  let last: DeskUIMessage | undefined;
  for await (const message of readUIMessageStream<DeskUIMessage>({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    terminateOnError: true,
  }))
    last = message;
  if (!last) throw new Error("No message produced");
  return last;
}

function texts(message: DeskUIMessage) {
  return message.parts.flatMap((part) =>
    part.type === "text" ? [part.text] : [],
  );
}

describe("native events through the installed AI SDK", () => {
  it("keeps streamed prose once and does not manufacture reasoning", async () => {
    const message = await consume([
      { event: "message.delta", delta: "Hel" },
      { event: "message.delta", delta: "lo" },
      { event: "reasoning.available", text: "Hello" },
      { event: "run.completed", output: "Hello" },
    ]);
    expect(texts(message)).toEqual(["Hello"]);
    expect(message.parts.some((part) => part.type === "reasoning")).toBe(false);
  });

  it("ignores the native truncated preview after a long streamed answer", async () => {
    const output = "A complete answer. ".repeat(40);
    const message = await consume([
      { event: "message.delta", delta: output },
      { event: "reasoning.available", text: output.trim().slice(0, 500) },
      { event: "run.completed", output },
    ]);
    expect(texts(message)).toEqual([output]);
  });

  it("promotes a complete non-streamed preview into final answer text", async () => {
    const message = await consume([
      { event: "reasoning.available", text: "The answer." },
      { event: "run.completed", output: "The answer." },
    ]);
    expect(texts(message)).toEqual(["The answer."]);
    const answer = message.parts.find((part) => part.type === "text");
    expect(answer?.providerMetadata?.pythia?.preview).not.toBe(true);
  });

  it.each(["", "partial", "an incorrect draft"])(
    "replaces tail %j with authoritative output, preserving tools and commentary",
    async (tail) => {
      const message = await consume([
        { event: "message.delta", delta: "I'll check." },
        {
          event: "tool.started",
          tool: "terminal",
          preview: "date",
          timestamp: 100,
        },
        {
          event: "tool.completed",
          tool: "terminal",
          duration: 2,
          timestamp: 102,
        },
        { event: "message.delta", delta: tail },
        { event: "run.completed", output: "The complete answer." },
      ]);
      expect(texts(message)).toEqual(["I'll check.", "The complete answer."]);
      expect(
        message.parts.find((part) => part.type === "dynamic-tool"),
      ).toMatchObject({
        state: "output-available",
        resultProviderMetadata: { pythia: { durationSeconds: 2 } },
      });
      expect(message.metadata?.outcome).toBe("completed");
    },
  );

  it("uses non-streamed commentary as a labelled preview, without duplicating the final preview", async () => {
    const message = await consume([
      { event: "reasoning.available", text: "Let me check." },
      { event: "tool.started", tool: "terminal" },
      { event: "tool.completed", tool: "terminal" },
      { event: "reasoning.available", text: "The final preview" },
      {
        event: "run.completed",
        output: "The final preview and the remainder.",
      },
    ]);
    expect(texts(message)).toEqual([
      "Let me check.",
      "The final preview and the remainder.",
    ]);
    expect(message.parts.find((part) => part.type === "text")).toMatchObject({
      providerMetadata: { pythia: { preview: true } },
    });
  });

  it("recovers the full answer from terminal status after a dropped stream", async () => {
    const message = await consume(
      [{ event: "message.delta", delta: "partial" }],
      { run_id: "run-1", status: "completed", output: "partial answer" },
    );
    expect(texts(message)).toEqual(["partial answer"]);
  });

  it("carries native usage, model selection, and delegated task progress into the UI message", async () => {
    const message = await consume(
      [
        { event: "tool.started", tool: "delegate_task" },
        {
          event: "subagent.start",
          child_session_id: "child-1",
          goal: "Review the filing",
          task_count: 2,
          model: "research-model",
        },
        {
          event: "subagent.complete",
          child_session_id: "child-1",
          status: "completed",
          duration_seconds: 12.4,
          tool_count: 3,
          input_tokens: 800,
          output_tokens: 120,
        },
        { event: "tool.completed", tool: "delegate_task" },
        {
          event: "run.completed",
          output: "Reviewed.",
          usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 },
        },
      ],
      undefined,
      { provider: "fixture", model: "research-model", effort: "high" },
    );
    expect(message.metadata).toMatchObject({
      outcome: "completed",
      run: {
        model: "research-model",
        provider: "fixture",
        usage: { total_tokens: 1200 },
      },
    });
    expect(
      message.parts.find((part) => part.type === "dynamic-tool"),
    ).toMatchObject({
      input: {
        tasks: [
          {
            goal: "Review the filing",
            status: "completed",
            durationSeconds: 12.4,
            toolCount: 3,
          },
        ],
      },
    });
  });

  it("does not assign outcomes to overlapping calls without native call IDs", async () => {
    const message = await consume([
      { event: "tool.started", tool: "web_search", preview: "First" },
      { event: "tool.started", tool: "web_search", preview: "Second" },
      { event: "tool.completed", tool: "web_search", error: true },
      { event: "tool.completed", tool: "web_search", error: false },
      { event: "run.completed", output: "Done" },
    ]);
    expect(
      message.parts
        .filter((part) => part.type === "dynamic-tool")
        .map((part) => part.state),
    ).toEqual(["input-available", "input-available"]);
  });

  it("preserves the inspected command and description when approval is answered", async () => {
    const message = await consume([
      {
        event: "approval.request",
        request_id: "a",
        description: "Delete generated file",
        command: "rm /tmp/generated.txt",
        choices: ["once", "deny"],
      },
      { event: "approval.responded", request_id: "a", choice: "once" },
      { event: "run.completed", output: "Done" },
    ]);
    expect(
      message.parts.filter((part) => part.type === "data-approval"),
    ).toEqual([
      expect.objectContaining({
        data: {
          runId: "run-1",
          requestId: "a",
          description: "Delete generated file",
          command: "rm /tmp/generated.txt",
          choices: [],
          responded: "once",
        },
      }),
    ]);
  });

  it.each(["run.failed", "run.cancelled"])(
    "preserves partial work on %s without promoting a pending tool",
    async (event) => {
      const message = await consume([
        { event: "message.delta", delta: "Checking." },
        { event: "tool.started", tool: "terminal" },
        { event, error: "Failure" },
      ]);
      expect(texts(message)).toEqual(["Checking."]);
      expect(
        message.parts.find((part) => part.type === "dynamic-tool"),
      ).toMatchObject({ state: "input-available" });
      const status = message.parts.find(
        (part) => part.type === "data-run-status",
      );
      expect(status).toMatchObject({
        data: { state: event === "run.failed" ? "failed" : "cancelled" },
      });
      if (event === "run.failed")
        expect(status).toMatchObject({ data: { message: "Failure" } });
      expect(message.metadata?.outcome).toBeUndefined();
    },
  );

  it("leaves unknown disconnects distinct from a confirmed stop", async () => {
    const message = await consume(
      [{ event: "tool.started", tool: "terminal" }],
      null,
    );
    expect(
      message.parts.find((part) => part.type === "data-run-status"),
    ).toMatchObject({ data: { state: "disconnected" } });
  });
});
