import { afterEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { DeskApi, DeskApiError } from "@/client/api";
import { DeskChats } from "@/client/desk-chat";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** A run that keeps working until `finish` is called. */
function running() {
  vi.useFakeTimers();
  const api = new DeskApi();
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const start = vi
    .spyOn(api, "startRun")
    .mockResolvedValue({ run_id: "run", status: "started", replayed: false });
  vi.spyOn(api, "listMessages").mockResolvedValue({
    data: [],
    limit: 100,
    offset: 0,
    returned: 0,
  });
  vi.spyOn(api, "getRun").mockResolvedValue({
    run_id: "run",
    status: "running",
  });
  vi.spyOn(api, "streamRun").mockImplementation(async function* () {
    await done;
    yield { event: "run.completed", run_id: "run", output: "Answer" };
  });
  const steer = vi.spyOn(api, "steerRun");
  const session = new DeskChats(api, new QueryClient()).get("session", []);
  session.send("First");
  return { session, start, steer, finish };
}

it("shows guidance at once and keeps it while Hermes accepts it", async () => {
  const f = running();
  await vi.advanceTimersByTimeAsync(0);
  f.steer.mockResolvedValue({ run_id: "run", accepted: true });
  const sent = f.session.steer("Use euros");
  expect(f.session.snapshot().steers.map((s) => s.text)).toEqual(["Use euros"]);
  await sent;
  expect(f.session.snapshot().steers).toHaveLength(1);
  f.finish();
});

it("withdraws guidance the running reply refuses, in plain words", async () => {
  const f = running();
  await vi.advanceTimersByTimeAsync(0);
  f.steer.mockRejectedValue(
    new DeskApiError(
      "Run is not currently accepting steer input: run",
      409,
      "run_not_accepting_steer",
    ),
  );
  await expect(f.session.steer("Use euros")).rejects.toThrow(
    "Pythia can't take direction at this point in the reply.",
  );
  expect(f.session.snapshot().steers).toEqual([]);
  expect(f.start).toHaveBeenCalledTimes(1);
  f.finish();
});

it("sends guidance as the next message when the reply finished first", async () => {
  const f = running();
  await vi.advanceTimersByTimeAsync(0);
  let reject = (_: Error) => {};
  f.steer.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const sent = f.session.steer("Use euros");
  f.finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.session.chat.status).toBe("ready");
  reject(new DeskApiError("Run is not currently accepting", 409));
  await sent;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.session.snapshot().steers).toEqual([]);
  expect(f.start).toHaveBeenCalledTimes(2);
  expect(f.start.mock.calls[1]?.[1]).toBe("Use euros");
});
