import { describe, expect, it } from "vitest";
import type { DeskUIMessage } from "@/client/chat-message";
import { WAKE_WINDOW_MS, wakeFollow } from "@/components/chat/wake-follow";
import type { WorkAgent } from "@/work/types";

const now = 2_000_000_000_000;
const agent = (endedAgo: number | null): WorkAgent => ({
  id: "child",
  goal: "Check",
  status: endedAgo === null ? "running" : "ended",
  ...(endedAgo === null ? {} : { endedAt: (now - endedAgo) / 1000 }),
});
const reply = (text: string, completedAt?: number): DeskUIMessage => ({
  id: `a-${text}`,
  role: "assistant",
  ...(completedAt ? { metadata: { run: { completedAt } } } : {}),
  parts: [{ type: "text", text }],
});
const notice: DeskUIMessage = {
  id: "notice",
  role: "system",
  metadata: { note: "async_delegation_complete" },
  parts: [{ type: "text", text: "[ASYNC DELEGATION COMPLETE — d]" }],
};
const working: DeskUIMessage = {
  id: "wake",
  role: "assistant",
  parts: [
    {
      type: "dynamic-tool",
      toolCallId: "t",
      toolName: "read_file",
      input: { path: "a.md" },
      state: "input-available",
    },
  ],
};

describe("following Hermes's reply to finished background agents", () => {
  it("waits, then follows the reply in progress, then stops", () => {
    const handoff = reply("An agent is checking.", now - 60_000);
    expect(wakeFollow([agent(5_000)], [handoff], false, now)).toEqual({
      poll: true,
      show: "reply",
    });
    expect(
      wakeFollow([agent(5_000)], [handoff, notice, working], false, now),
    ).toEqual({ poll: true, show: "tail" });
    expect(
      wakeFollow([agent(5_000)], [handoff, notice, reply("Done.")], false, now),
    ).toEqual({ poll: false, show: false });
  });

  it("keeps reading, without claiming work, when the turn ended after the agent", () => {
    const later = reply("Parent wrapped up.", now - 1_000);
    expect(wakeFollow([agent(5_000)], [later], false, now)).toEqual({
      poll: true,
      show: false,
    });
  });

  it("does nothing while a run streams, an agent works, or after Hermes's wake timeout", () => {
    const handoff = reply("An agent is checking.", now - 60_000);
    const idle = { poll: false, show: false };
    expect(wakeFollow([agent(5_000)], [handoff], true, now)).toEqual(idle);
    expect(wakeFollow([agent(null)], [handoff], false, now)).toEqual(idle);
    expect(
      wakeFollow([agent(WAKE_WINDOW_MS + 1)], [handoff], false, now),
    ).toEqual(idle);
  });
});
