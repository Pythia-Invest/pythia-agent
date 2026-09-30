import { describe, expect, it } from "vitest";
import { duration, trayAgents } from "@/components/chat/agent-tray";
import type { WorkAgent } from "@/work/types";

const now = 1_000_000;
const minute = 60;
const agent = (
  id: string,
  status: WorkAgent["status"],
  times: Pick<WorkAgent, "startedAt" | "lastActive" | "endedAt"> = {},
): WorkAgent => ({ id, sessionId: id, goal: id, status, ...times });
const ids = (list: WorkAgent[]) => list.map((a) => a.id);

describe("which agents the tray keeps", () => {
  it("keeps working agents in start order however long they have run", () => {
    const { working } = trayAgents(
      [
        agent("late", "running", { startedAt: now - minute }),
        agent("early", "running", { startedAt: now - 5 * 60 * minute }),
      ],
      now,
    );
    expect(ids(working)).toEqual(["early", "late"]);
  });

  it.each([
    ["just now", 0, true],
    ["at the two hour limit", 120 * minute, true],
    ["a second past two hours", 120 * minute + 1, false],
  ])("keeps a quiet agent active %s: %s", (_label, age, kept) => {
    const { quiet } = trayAgents(
      [agent("quiet", "unknown", { lastActive: now - age })],
      now,
    );
    expect(ids(quiet)).toEqual(kept ? ["quiet"] : []);
  });

  it("drops a quiet agent with no native activity time", () => {
    expect(ids(trayAgents([agent("blank", "unknown")], now).quiet)).toEqual([]);
  });

  it.each([
    ["just now", 0, true],
    ["at the thirty minute limit", 30 * minute, true],
    ["a second past thirty minutes", 30 * minute + 1, false],
  ])("keeps an agent that finished %s: %s", (_label, age, kept) => {
    const { finished } = trayAgents(
      [agent("done", "completed", { endedAt: now - age })],
      now,
    );
    expect(ids(finished)).toEqual(kept ? ["done"] : []);
  });

  it.each(["completed", "stopped", "failed", "ended"] as const)(
    "counts a %s agent as finished, newest first",
    (status) => {
      const { finished } = trayAgents(
        [
          agent("older", status, { endedAt: now - 20 * minute }),
          agent("newer", status, { endedAt: now - minute }),
        ],
        now,
      );
      expect(ids(finished)).toEqual(["newer", "older"]);
    },
  );

  it("drops an ended agent that has no end time", () => {
    const { finished } = trayAgents([agent("undated", "ended")], now);
    expect(finished).toEqual([]);
  });

  it("does not let an old end time or a stale start time hide a working agent", () => {
    const shown = trayAgents(
      [
        agent("busy", "running", {
          startedAt: now - 10 * 60 * minute,
          endedAt: now - 60 * minute,
        }),
      ],
      now,
    );
    expect(ids(shown.working)).toEqual(["busy"]);
    expect(shown.finished).toEqual([]);
  });
});

describe("duration", () => {
  it.each([
    [0, "0s"],
    [59, "59s"],
    [60, "1m 00s"],
    [61, "1m 01s"],
    [3599, "59m 59s"],
    [3600, "1h 00m"],
    [3660 + 59, "1h 01m"],
    [-5, "0s"],
  ])("formats %i seconds as %s", (seconds, text) => {
    expect(duration(seconds)).toBe(text);
  });
});
