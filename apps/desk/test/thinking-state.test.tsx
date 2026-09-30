import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "@/components/chat/assistant-message";
import type { DeskUIMessage } from "@/client/chat-message";

function render(message: DeskUIMessage, streaming: boolean) {
  return renderToStaticMarkup(
    <AssistantMessage
      approvalPending={false}
      message={message}
      onRespondToApproval={() => undefined}
      streaming={streaming}
      turnStartedAt={Date.now()}
    />,
  );
}

const empty: DeskUIMessage = { id: "m1", role: "assistant", parts: [] };

describe("thinking state", () => {
  it("stands in for a reply that has produced nothing yet", () => {
    // Hermes streams no private reasoning, so between the prompt and the first
    // token this row is the only thing saying work is happening.
    const markup = render(empty, true);
    expect(markup).toContain('data-slot="turn-activity"');
    expect(markup).toContain('data-state="live"');
    expect(markup).toContain("Thinking");
    expect(markup).toContain('aria-live="polite"');
  });

  it("gives way to the answer when a reply did no visible work", () => {
    const markup = render(
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Cover is 1.08×", state: "streaming" }],
      },
      true,
    );
    // Streaming words are wrapped for their fade-in; compare visible text.
    expect(markup.replaceAll(/<[^>]+>/gu, "")).toContain("Cover is 1.08×");
    expect(markup).not.toContain('data-slot="turn-activity"');
  });

  it("shows nothing at all for a settled turn with no recorded work", () => {
    expect(render(empty, false)).not.toContain('data-slot="turn-activity"');
  });
});

describe("how long it took", () => {
  it("keeps the turn's duration on the settled disclosure", () => {
    // Completed duration comes from Hermes, not a browser stopwatch.
    const markup = render(
      {
        id: "m1",
        metadata: { outcome: "completed", run: { durationSeconds: 12.4 } },
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "t1",
            toolName: "web_search",
            state: "output-available",
            input: { query: "coverage ratio" },
            output: "ok",
          },
        ],
      },
      false,
    );
    expect(markup).toContain("Worked for 12s");
  });
});
