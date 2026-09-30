import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatAttention } from "@/client/chat-attention";
import { QueryClient } from "@tanstack/react-query";
import { DeskChats } from "@/client/desk-chat";
import { DeskApi } from "@/client/api";
import type { DeskUIMessage } from "@/client/chat-message";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("chat attention", () => {
  it("marks newly observed saved answers, but not pagination or user-only changes", () => {
    const chats = new DeskChats(new DeskApi(), new QueryClient());
    const message = (
      id: string,
      role: "user" | "assistant",
      text: string,
    ): DeskUIMessage => ({
      id,
      role,
      parts: [{ type: "text", text }],
      metadata: { historyRows: [id] },
    });
    const question = message("question", "user", "Question");
    const chat = chats.get("a", [question]);
    chat.addHistory([message("old", "assistant", "Older answer"), question]);
    expect(chats.attention.snapshot().unreadIds.has("a")).toBe(false);
    chat.addHistory([
      question,
      message("another-question", "user", "Another question"),
    ]);
    expect(chats.attention.snapshot().unreadIds.has("a")).toBe(false);
    chat.addHistory([
      question,
      message("another-question", "user", "Another question"),
      message("answer", "assistant", "New saved answer"),
    ]);
    expect(chats.attention.snapshot().unreadIds.has("a")).toBe(true);
  });

  it("keeps work independent of unread replies until a visible reader acknowledges them", () => {
    const attention = new ChatAttention();
    let visible = false;
    const unsubscribe = attention.reader("a", () => visible);
    attention.working("a", true);
    attention.reply("a");
    attention.read("a");
    expect(attention.snapshot().workingIds.has("a")).toBe(true);
    expect(attention.snapshot().unreadIds.has("a")).toBe(true);
    attention.working("a", false);
    expect(attention.snapshot().unreadIds.has("a")).toBe(true);
    visible = true;
    attention.read("a");
    expect(attention.snapshot().unreadIds.has("a")).toBe(false);
    attention.reply("a");
    expect(attention.snapshot().unreadIds.has("a")).toBe(false);
    unsubscribe();
    attention.reply("a");
    expect(attention.snapshot().unreadIds.has("a")).toBe(true);
  });

  it("retains unread IDs over reload without claiming old work is still running", () => {
    const before = new ChatAttention();
    before.working("a", true);
    before.reply("a");
    before.reply("b");
    const after = new ChatAttention();
    after.reader("b", () => true);
    after.restore();
    expect([...after.snapshot().unreadIds]).toEqual(["a"]);
    expect([...after.snapshot().workingIds]).toEqual([]);
  });

  it("does not notify on every redundant activity update or depend on available storage", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("Unavailable");
      },
      setItem: () => {
        throw new Error("Unavailable");
      },
    });
    const attention = new ChatAttention();
    const changed = vi.fn();
    attention.subscribe(changed);
    attention.restore();
    attention.working("a", true);
    attention.working("a", true);
    expect(changed).toHaveBeenCalledTimes(1);
    attention.reply("a");
    expect(attention.snapshot().unreadIds.has("a")).toBe(true);
  });
});
