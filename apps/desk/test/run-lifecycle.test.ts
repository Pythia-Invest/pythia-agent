import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { DeskApi } from "../src/client/api";
import { historyToMessages } from "../src/client/chat-message";
import { DeskChats } from "../src/client/desk-chat";
import type { DeskRunEvent, RunStart, RunStatus } from "../src/server/types";

function fixture() {
  vi.useFakeTimers();
  const api = new DeskApi();
  const cache = new QueryClient();
  let status: RunStatus = { run_id: "run", status: "running" };
  const getStatus = vi
    .spyOn(api, "getRun")
    .mockImplementation(async () => status);
  const start = vi
    .spyOn(api, "startRun")
    .mockResolvedValue({ run_id: "run", status: "running", replayed: false });
  const stop = vi.spyOn(api, "stopRun").mockImplementation(async () => {
    status = { ...status, status: "cancelled" };
    return status;
  });
  const stream = vi
    .spyOn(api, "streamRun")
    .mockImplementation(
      async function* (_id, signal): AsyncGenerator<DeskRunEvent> {
        yield { event: "message.delta", run_id: "run", delta: "Partial" };
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
          if (signal.aborted) resolve();
        });
      },
    );
  vi.spyOn(api, "listMessages").mockResolvedValue({
    data: [],
    limit: 100,
    offset: 0,
    returned: 0,
  });
  const chats = new DeskChats(api, cache);
  const session = chats.get("chat", []);
  return {
    api,
    chats,
    session,
    start,
    stop,
    stream,
    getStatus,
    setStatus: (next: RunStatus) => {
      status = next;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SDK chat and native run lifetime", () => {
  it("keeps one stream across observers and reconciles a terminal status even if SSE stalls", async () => {
    const f = fixture();
    f.session.initialize(() => ({ text: "Question", attachments: [] }));
    await vi.advanceTimersByTimeAsync(0);
    const again = f.chats.get("chat", []);
    again.initialize(() => {
      throw new Error("A remount must not send or resume again");
    });
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.stream).toHaveBeenCalledTimes(1);
    f.setStatus({ run_id: "run", status: "completed", output: "Final answer" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(again.chat.status).toBe("ready");
    expect(JSON.stringify(again.chat.messages)).toContain("Final answer");
    expect(f.session.transport.activeRun("chat")).toBeNull();
  });

  it("waits for run creation before Stop and follows native cancellation", async () => {
    const f = fixture();
    const created = Promise.withResolvers<RunStart>();
    f.start.mockReturnValue(created.promise);
    f.session.send("Question");
    await vi.advanceTimersByTimeAsync(0);
    const stopping = f.session.stop();
    expect(f.stop).not.toHaveBeenCalled();
    created.resolve({ run_id: "run", status: "running", replayed: false });
    await stopping;
    expect(f.stop).toHaveBeenCalledWith("run");
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.session.chat.status).toBe("ready");
    expect(JSON.stringify(f.session.chat.messages)).toContain(
      '"state":"cancelled"',
    );
  });

  it("keeps reading after a rejected Stop and allows another attempt", async () => {
    const f = fixture();
    f.session.send("Question");
    await vi.advanceTimersByTimeAsync(0);
    f.stop.mockRejectedValueOnce(new Error("Stop rejected"));
    await f.session.stop();
    expect(f.session.snapshot().stopError).toBe("Stop rejected");
    expect(f.session.chat.status).toBe("streaming");
    await f.session.stop();
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.session.chat.status).toBe("ready");
  });

  it("recovers a completed run from status without opening its expired event queue", async () => {
    const f = fixture();
    vi.stubGlobal("sessionStorage", {
      getItem: () => "run",
      removeItem: vi.fn(),
    });
    f.setStatus({ run_id: "run", status: "completed", output: "Saved answer" });
    f.session.initialize(() => null);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.stream).not.toHaveBeenCalled();
    expect(JSON.stringify(f.session.chat.messages)).toContain("Saved answer");
  });

  it("polls approvals and the final answer after the native stream is lost", async () => {
    const f = fixture();
    f.stream.mockImplementation(async function* () {
      yield await Promise.reject(new Error("Native queue gone"));
    });
    f.session.send("Question");
    await vi.advanceTimersByTimeAsync(0);
    f.setStatus({
      run_id: "run",
      status: "waiting_for_approval",
      approval: {
        event: "approval.request",
        run_id: "run",
        request_id: "permission",
        command: "date",
        choices: ["once", "deny"],
      },
    });
    await vi.advanceTimersByTimeAsync(3000);
    const approvals = f.session.chat.messages
      .at(-1)
      ?.parts.filter((part) => part.type === "data-approval");
    expect(approvals).toHaveLength(1);
    expect(approvals?.[0]).toMatchObject({
      data: { command: "date", choices: ["once", "deny"] },
    });
    f.setStatus({
      run_id: "run",
      status: "completed",
      output: "Finished via status",
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(JSON.stringify(f.session.chat.messages)).toContain(
      "Finished via status",
    );
    expect(f.stream).toHaveBeenCalledTimes(1);
  });

  it("reports disconnection, not run failure, after repeated status failures", async () => {
    const f = fixture();
    f.stream.mockImplementation(async function* () {
      yield await Promise.reject(new Error("Offline"));
    });
    f.getStatus.mockRejectedValue(new Error("Offline"));
    f.session.send("Question");
    await vi.advanceTimersByTimeAsync(4500);
    expect(f.session.snapshot().connection).toBe("disconnected");
    expect(JSON.stringify(f.session.chat.messages)).toContain(
      '"state":"disconnected"',
    );
    expect(f.session.transport.activeRun("chat")).toBe("run");
    expect(f.stop).not.toHaveBeenCalled();
  });
});

it("refreshes an idle retained chat but preserves a submitted local turn", async () => {
  const f = fixture();
  const initial = historyToMessages([
    { id: "u1", role: "user", content: "Earlier" },
    { id: "a1", role: "assistant", content: "Earlier answer" },
  ]);
  const refreshed = [
    ...initial,
    ...historyToMessages([
      { id: "u2", role: "user", content: "From another client" },
      { id: "a2", role: "assistant", content: "Newer answer" },
    ]),
  ];
  f.session.addHistory(initial);
  f.session.addHistory(refreshed);
  expect(f.session.chat.messages).toEqual(refreshed);
  f.session.send("Local follow-up");
  const submitted = f.session.chat.messages;
  f.session.addHistory([
    ...refreshed,
    {
      id: "external-next",
      role: "user",
      parts: [{ type: "text", text: "External follow-up" }],
    },
  ]);
  expect(f.session.chat.messages).toEqual(submitted);
  await f.session.chat.stop();
});
