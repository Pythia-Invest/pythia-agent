import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantMessage } from "@/components/chat/assistant-message";
import { ProcessStepView } from "@/components/chat/process-steps";
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
    expect(markup).toContain('data-slot="process-block"');
    expect(markup).toContain('data-state="live"');
    expect(markup).toContain("Thinking");
    expect(markup).toContain('role="status"');
  });

  it("gives way once the answer starts arriving", () => {
    const markup = render(
      {
        id: "m1",
        role: "assistant",
        parts: [{ type: "text", text: "Cover is 1.08×", state: "streaming" }],
      },
      true,
    );
    expect(markup).toContain("Cover is 1.08×");
    expect(markup).not.toContain('data-state="live"');
  });

  it("shows nothing at all for a settled turn with no recorded work", () => {
    expect(render(empty, false)).not.toContain('data-slot="process-block"');
  });
});

describe("how long it took", () => {
  it("keeps the turn's duration on the settled disclosure", () => {
    // The live timer stops when the run does; the number it reached is what
    // the reader wants afterwards, so Hermes' own measure replaces it.
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
            input: {},
            output: "ok",
          },
        ],
      },
      false,
    );
    expect(markup).toContain("1 step");
    expect(markup).toContain("12s");
  });

  it("reads a tool's own duration back from where the SDK files it", () => {
    // Completed tools land under resultProviderMetadata, not the call one.
    const markup = renderToStaticMarkup(
      <ProcessStepView
        runActive={false}
        step={{
          kind: "tool",
          key: "t1",
          part: {
            type: "dynamic-tool",
            toolCallId: "t1",
            toolName: "web_search",
            state: "output-available",
            input: {},
            output: "ok",
            resultProviderMetadata: { pythia: { durationSeconds: 3 } },
          },
        }}
      />,
    );
    expect(markup).toContain("3s");
  });
});
