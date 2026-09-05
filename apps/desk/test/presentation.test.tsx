import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { conversationSelection, PythiaDesk } from "@/components/desk";
import {
  ApprovalCard,
  Onboarding,
  RunOutcome,
} from "@/components/presentation";
import { saveCredentialInput } from "@/components/settings";

describe("Desk presentation states", () => {
  it("gives the loading shell an announced status and named navigation", () => {
    const markup = renderToStaticMarkup(<PythiaDesk />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Opening Pythia Desk");
    expect(markup).toContain('aria-label="Conversation history"');
    expect(markup).toContain("New conversation");
  });

  it("keeps the first prompt when selecting a newly created Hermes session", () => {
    expect(conversationSelection("session-1", "Research Apple")).toEqual({
      activeId: "session-1",
      initialPrompt: "Research Apple",
    });
  });

  it("shows actionable model onboarding without a credential value", () => {
    const markup = renderToStaticMarkup(<Onboarding />);
    expect(markup).toContain("Connect a model account");
    expect(markup).toContain("just auth provider oauth");
    expect(markup).toContain("just auth provider api-key");
    expect(markup).not.toContain("API_SERVER_KEY");
  });

  it.each([
    [{ event: "run.completed" }, "Response complete", 'role="status"'],
    [{ event: "run.cancelled" }, "Run cancelled", 'role="status"'],
    [
      { event: "run.failed", error: "Bounded failure" },
      "The run failed",
      'role="alert"',
    ],
    [
      { event: "stream.disconnected", code: "stream_disconnected" },
      "Live updates disconnected",
      'role="status"',
    ],
  ] as const)(
    "renders terminal state %s independently",
    (event, text, role) => {
      const markup = renderToStaticMarkup(<RunOutcome event={event} />);
      expect(markup).toContain(text);
      expect(markup).toContain(role);
    },
  );

  it("renders explicit approve and reject actions with a named region", () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard
        event={{
          event: "approval.request",
          description: "Run the bounded command",
          choices: ["once", "deny"],
        }}
        onRespond={vi.fn()}
        pending={false}
      />,
    );
    expect(markup).toContain('aria-label="Hermes approval request"');
    expect(markup).toContain("Approve once");
    expect(markup).toContain("Reject");
  });

  it("keeps a credential input after a failed save and clears only on success", async () => {
    const secret = "PRIVATE_INPUT";
    await expect(saveCredentialInput(secret, async () => false)).resolves.toBe(
      secret,
    );
    await expect(saveCredentialInput(secret, async () => true)).resolves.toBe(
      "",
    );
  });
});
