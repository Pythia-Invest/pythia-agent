import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import type { DeskDataParts } from "@/client/chat-message";
import { RunEventMapper } from "@/client/hermes-run-mapper";
import { terminalEvent } from "@/client/run-terminal-event";
import { toolView } from "@/components/chat/tool-copy";
import { mapHermesEvent } from "@/server/hermes";
import type { DeskRunEvent } from "@/server/types";
import { captured, capturedClient, sseEvents } from "./hermes-capture";

type Chunk = UIMessageChunk<unknown, DeskDataParts>;
const RUNS = [
  "run-completed.json",
  "run-approval.json",
  "run-steered.json",
  "run-failed.json",
  "run-cancelled.json",
];

function run(name: string) {
  const { exchanges } = captured(name);
  const start = exchanges[0]?.body as { run_id: string };
  return { exchanges, runId: start.run_id, client: capturedClient(exchanges) };
}

async function stream(client: ReturnType<typeof capturedClient>, id: string) {
  const events: DeskRunEvent[] = [];
  for await (const event of client.streamRun(id)) events.push(event);
  return events;
}

function mapAll(runId: string, events: DeskRunEvent[]) {
  const mapper = new RunEventMapper(runId);
  return { mapper, chunks: events.flatMap((event) => mapper.map(event)) };
}

describe("pinned Hermes run stream", () => {
  it("keeps every event the pinned Hermes streams", () => {
    for (const name of RUNS) {
      for (const frame of sseEvents(captured(name).exchanges)) {
        expect(mapHermesEvent(frame), `${name}: ${frame.event}`).not.toBe(null);
      }
    }
  });

  it("maps a completed run with tools, research agents and usage", async () => {
    const { client, runId } = run("run-completed.json");
    const events = await stream(client, runId);
    const { chunks, mapper } = mapAll(runId, events);

    const tools = new Map<string, Chunk["type"]>();
    const names = new Map<string, string>();
    for (const chunk of chunks) {
      if (chunk.type === "tool-input-available")
        names.set(chunk.toolCallId, chunk.toolName);
      if (
        chunk.type === "tool-output-available" ||
        chunk.type === "tool-output-error"
      )
        tools.set(names.get(chunk.toolCallId) ?? "", chunk.type);
    }
    expect(tools.get("terminal")).toBe("tool-output-available");
    expect(tools.get("web_search")).toBe("tool-output-error");
    expect(tools.get("delegate_task")).toBe("tool-output-available");

    const agents = new Map<string, DeskDataParts["agent"]>();
    for (const chunk of chunks)
      if (chunk.type === "data-agent") agents.set(chunk.data.id, chunk.data);
    expect([...agents.values()].map((agent) => agent.status)).toEqual([
      "completed",
      "failed",
    ]);
    expect(agents.get("capture-child-session-1")).toMatchObject({
      sessionId: "capture-child-session-1",
      summary: "Three risk factors changed materially.",
    });

    const completed = events.at(-1);
    expect(completed).toMatchObject({
      event: "run.completed",
      pending_steer: "Also compare it with the prior year.",
    });
    const text = chunks
      .flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : []))
      .join("");
    expect(text).toContain(completed?.output);
    const finish = chunks.findLast((chunk) => chunk.type === "finish");
    expect(finish?.messageMetadata).toMatchObject({
      outcome: "completed",
      run: {
        usage: { input_tokens: 1500, output_tokens: 250, total_tokens: 1750 },
      },
    });
    expect(mapper.terminal).toBe(true);
  });

  it("shows Hermes reasoning as commentary before the first tool", async () => {
    const { client, runId } = run("run-completed.json");
    const { chunks } = mapAll(runId, await stream(client, runId));
    const first = chunks.find((chunk) => chunk.type === "text-delta");
    expect(first).toMatchObject({ delta: "I will check the filing first." });
  });

  it("names the deferred tool behind a live tool_call bridge event", async () => {
    const { client, runId } = run("run-completed.json");
    const { chunks } = mapAll(runId, await stream(client, runId));
    const bridge = chunks.find(
      (chunk) =>
        chunk.type === "tool-input-available" && chunk.toolName === "tool_call",
    );
    if (bridge?.type !== "tool-input-available") throw new Error("no bridge");
    expect(
      toolView({
        type: "dynamic-tool",
        toolCallId: bridge.toolCallId,
        toolName: bridge.toolName,
        input: bridge.input,
        state: "input-available",
      }).toolName,
    ).toBe("pythia_eod_prices");
  });

  it("resolves a native approval round trip", async () => {
    const { client, runId } = run("run-approval.json");
    const waiting = await client.getRun(runId);
    expect(waiting.status).toBe("waiting_for_approval");
    expect(waiting.approval).toMatchObject({
      command: "rm -rf ./build",
      choices: ["once", "session", "always", "deny"],
    });
    const requestId = waiting.approval?.request_id;
    expect(requestId).toBeTruthy();
    expect(await client.respondToApproval(runId, "once", requestId)).toEqual({
      run_id: runId,
      choice: "once",
      resolved: 1,
    });

    const { chunks } = mapAll(runId, await stream(client, runId));
    const approvals = chunks.flatMap((chunk) =>
      chunk.type === "data-approval" ? [chunk.data] : [],
    );
    expect(approvals[0]).toMatchObject({
      requestId,
      command: "rm -rf ./build",
      choices: ["once", "session", "always", "deny"],
    });
    expect(approvals[1]).toMatchObject({ requestId, responded: "once" });
    expect(terminalEvent(await client.getRun(runId))?.event).toBe(
      "run.completed",
    );
  });

  it("accepts steering and shows it where Hermes accepted it", async () => {
    const { client, runId } = run("run-steered.json");
    expect((await client.getRun(runId)).status).toBe("running");
    expect(await client.steerRun(runId, "Focus on 2025 only.")).toEqual({
      run_id: runId,
      accepted: true,
    });
    const events = await stream(client, runId);
    const steered = events.find((event) => event.event === "run.steered");
    expect(steered).toBeDefined();
    const mapper = new RunEventMapper(runId);
    const chunks = mapper.steered(steered as DeskRunEvent, {
      id: "steer-1",
      text: "Focus on 2025 only.",
    });
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-steer",
        data: expect.objectContaining({ text: "Focus on 2025 only." }),
      }),
    );
  });

  it("reports a failed run with Hermes's error", async () => {
    const { client, runId } = run("run-failed.json");
    const { chunks } = mapAll(runId, await stream(client, runId));
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-run-status",
        data: expect.objectContaining({
          state: "failed",
          message: "Error code: 429 - rate limit reached",
        }),
      }),
    );
    expect(terminalEvent(await client.getRun(runId))).toMatchObject({
      event: "run.failed",
      error: "Error code: 429 - rate limit reached",
    });
  });

  it("stops a run and recognizes the cancelled outcome", async () => {
    const { client, runId } = run("run-cancelled.json");
    expect(await client.stopRun(runId)).toEqual({
      run_id: runId,
      status: "stopping",
    });
    const { chunks } = mapAll(runId, await stream(client, runId));
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-run-status",
        data: expect.objectContaining({ state: "cancelled" }),
      }),
    );
    expect(terminalEvent(await client.getRun(runId))?.event).toBe(
      "run.cancelled",
    );
  });

  it("recognizes every terminal status and no live one as terminal", () => {
    for (const name of RUNS) {
      const statuses = captured(name).exchanges.flatMap((exchange) =>
        /^\/v1\/runs\/[^/]+$/u.test(exchange.request.path) &&
        exchange.request.method === "GET"
          ? [exchange.body as { run_id: string; status: string }]
          : [],
      );
      for (const status of statuses) {
        const terminal = ["completed", "failed", "cancelled"].includes(
          status.status,
        );
        expect(
          terminalEvent(status) !== null,
          `${name}: ${status.status}`,
        ).toBe(terminal);
      }
    }
  });
});

describe("pinned Hermes service surface", () => {
  const { exchanges } = captured("service.json");

  it("offers steering only because Hermes advertises it", async () => {
    expect(await capturedClient(exchanges).capabilities()).toEqual({
      runSteer: true,
      modelOptions: true,
    });
  });

  it("reports Hermes's own error code for a rejected key", async () => {
    const rejected = exchanges.filter((exchange) => exchange.status === 401);
    await expect(capturedClient(rejected).capabilities()).rejects.toMatchObject(
      { status: 401, code: "gateway_auth_failed" },
    );
  });

  it("creates a titled session and recognizes a refused title", async () => {
    const client = capturedClient(
      exchanges.filter((exchange) => exchange.request.path === "/api/sessions"),
    );
    expect(await client.createSession("Capture chat")).toMatchObject({
      title: "Capture chat",
    });
    await expect(client.createSession("Capture chat")).rejects.toMatchObject({
      status: 400,
      code: "invalid_title",
    });
  });
});
