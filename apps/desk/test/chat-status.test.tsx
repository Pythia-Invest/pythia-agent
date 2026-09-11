import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CatalogError,
  ChatError,
  ChatNote,
  ConnectionNote,
} from "@/components/chat/chat-status";

describe("connection", () => {
  it("says nothing while the stream is healthy", () => {
    expect(renderToStaticMarkup(<ConnectionNote state="ok" />)).toBe("");
  });

  it("separates a dropped stream from a failed run", () => {
    // Hermes carries on when the browser loses the stream; the copy must not
    // imply the run died with it.
    const reconnecting = renderToStaticMarkup(
      <ConnectionNote state="reconnecting" />,
    );
    expect(reconnecting).toContain("Live activity interrupted");
    expect(reconnecting).toContain("Checking run status.");

    const lost = renderToStaticMarkup(<ConnectionNote state="disconnected" />);
    expect(lost).toContain("Connection lost");
    expect(lost).toContain("The run was not cancelled.");
  });
});

describe("outcomes", () => {
  it("puts the cause first and the identifiers under it", () => {
    const markup = renderToStaticMarkup(
      <ChatError
        context="OpenAI · gpt-5 · HTTP 429"
        message="The provider refused the request."
        onRetry={vi.fn()}
      />,
    );
    expect(markup.indexOf("The provider refused the request.")).toBeLessThan(
      markup.indexOf("HTTP 429"),
    );
    expect(markup).toContain("Retry");
    expect(markup).toContain('role="alert"');
  });

  it("does not dress a stop as an error", () => {
    const markup = renderToStaticMarkup(<ChatNote>Stopped.</ChatNote>);
    expect(markup).toContain("Stopped.");
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("text-error");
  });

  it("says the catalog failed rather than hiding the control", () => {
    const markup = renderToStaticMarkup(
      <CatalogError onRetry={vi.fn()} retrying={false} />,
    );
    expect(markup).toContain("Model catalog unavailable");
    expect(markup).toContain("Retry");
  });
});
