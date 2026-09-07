import { describe, expect, it } from "vitest";
import { RunEventMapper } from "../src/client/hermes-transport";

function chunks(
  mapper: RunEventMapper,
  events: Parameters<RunEventMapper["map"]>[0][],
) {
  return events.flatMap((event) => mapper.map(event));
}

describe("Hermes run events to UI message chunks", () => {
  it("streams text into one text part and closes it on completion", () => {
    const mapper = new RunEventMapper("run-1");
    const out = chunks(mapper, [
      { event: "message.delta", delta: "Hel" },
      { event: "message.delta", delta: "lo" },
      { event: "run.completed", output: "Hello" },
    ]);
    expect(out.map((c) => c.type)).toEqual([
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    expect(mapper.terminal).toBe(true);
  });

  it("uses the final output when no deltas were streamed", () => {
    const out = new RunEventMapper("run-2").map({
      event: "run.completed",
      output: "Done.",
    });
    expect(out).toEqual([
      { type: "text-start", id: "run-2:text:1" },
      { type: "text-delta", id: "run-2:text:1", delta: "Done." },
      { type: "text-end", id: "run-2:text:1" },
      { type: "finish-step" },
      { type: "finish" },
    ]);
  });

  it("pairs tool completion with the earliest open call of that tool", () => {
    const mapper = new RunEventMapper("run-3");
    const out = chunks(mapper, [
      { event: "message.delta", delta: "Looking." },
      { event: "tool.started", tool: "web_search", preview: "ASML EUV" },
      { event: "tool.started", tool: "web_search", preview: "Lam WFE" },
      { event: "tool.completed", tool: "web_search", duration: 1.2 },
      { event: "tool.completed", tool: "web_search", error: true },
    ]);
    expect(out.map((c) => c.type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-available",
      "tool-input-available",
      "tool-output-available",
      "tool-output-error",
    ]);
    const [first, second] = out.filter(
      (c) => c.type === "tool-input-available",
    );
    expect(out[5]).toMatchObject({
      toolCallId: first?.toolCallId,
      output: { duration: 1.2 },
    });
    expect(out[6]).toMatchObject({ toolCallId: second?.toolCallId });
  });

  it("emits approvals as data parts keyed by request so a response replaces the request", () => {
    const mapper = new RunEventMapper("run-4");
    const out = chunks(mapper, [
      {
        event: "approval.request",
        request_id: "req-1",
        description: "Run `ls`",
        choices: ["once", "deny"],
      },
      { event: "approval.responded", request_id: "req-1", choice: "once" },
    ]);
    expect(out).toEqual([
      {
        type: "data-approval",
        id: "approval:req-1",
        data: {
          runId: "run-4",
          requestId: "req-1",
          description: "Run `ls`",
          choices: ["once", "deny"],
        },
      },
      {
        type: "data-approval",
        id: "approval:req-1",
        data: {
          runId: "run-4",
          requestId: "req-1",
          choices: [],
          responded: "once",
        },
      },
    ]);
  });

  it("reports failures and cancellations inline instead of erroring the stream", () => {
    const failed = new RunEventMapper("run-5").map({
      event: "run.failed",
      error: "Provider rejected the request.",
      code: "model_provider_failed",
    });
    expect(failed[0]).toEqual({
      type: "data-run-status",
      id: "run-5:status:1",
      data: {
        state: "failed",
        message: "Provider rejected the request.",
        code: "model_provider_failed",
      },
    });
    expect(failed.map((c) => c.type)).toContain("finish");
    const cancelled = new RunEventMapper("run-6").map({
      event: "run.cancelled",
    });
    expect(cancelled[0]).toMatchObject({ data: { state: "cancelled" } });
  });

  it("synthesizes the terminal state from run status after a dropped stream", () => {
    const mapper = new RunEventMapper("run-7");
    mapper.map({ event: "message.delta", delta: "partial" });
    const completed = mapper.disconnected({
      run_id: "run-7",
      status: "completed",
      output: "partial answer",
    });
    expect(completed.map((c) => c.type)).toEqual([
      "text-end",
      "finish-step",
      "finish",
    ]);
    const unknown = new RunEventMapper("run-8").disconnected(null);
    expect(unknown[0]).toMatchObject({
      type: "data-run-status",
      data: { state: "disconnected", code: "stream_disconnected" },
    });
  });
});
