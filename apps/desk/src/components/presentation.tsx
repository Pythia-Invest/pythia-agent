import { Button, SemanticMessage } from "@pythia/ui";
import type { ApprovalChoice, DeskRunEvent } from "@/server/types";

export function Onboarding({ compact = false }: { compact?: boolean }) {
  return (
    <SemanticMessage title="Connect a model account" tone="information">
      <p>
        Hermes needs credentials for the selected provider. In development, use{" "}
        <code>just auth provider oauth</code> or{" "}
        <code>just auth provider api-key</code>, replacing provider with its
        native Hermes name. On an installed device, use native Hermes
        authentication for that device.
      </p>
      {!compact ? (
        <p>
          Your existing conversations remain available while authentication is
          missing.
        </p>
      ) : null}
    </SemanticMessage>
  );
}

export function RunOutcome({ event }: { event: DeskRunEvent }) {
  if (event.event === "run.completed") {
    return (
      <SemanticMessage title="Response complete" tone="success">
        Hermes saved this turn to the conversation.
      </SemanticMessage>
    );
  }
  if (event.event === "run.cancelled") {
    return (
      <SemanticMessage title="Run cancelled" tone="warning">
        Hermes stopped this run. Completed conversation history remains saved.
      </SemanticMessage>
    );
  }
  if (event.code === "model_auth_missing") return <Onboarding compact />;
  if (event.code === "model_selection_missing")
    return (
      <SemanticMessage title="Choose a model" tone="information">
        {event.error}
      </SemanticMessage>
    );
  if (event.code === "model_provider_failed")
    return (
      <SemanticMessage title="Provider connection failed" tone="error">
        {event.error}
      </SemanticMessage>
    );
  if (event.event === "run.failed") {
    return (
      <SemanticMessage title="The run failed" tone="error">
        {String(event.error ?? "Hermes could not complete this run.")}
      </SemanticMessage>
    );
  }
  if (event.event === "stream.disconnected") {
    return (
      <SemanticMessage title="Live updates disconnected" tone="warning">
        The run was not cancelled. Desk checked its native Hermes status before
        reporting this state.
      </SemanticMessage>
    );
  }
  return null;
}

function approvalLabel(choice: ApprovalChoice) {
  if (choice === "once") return "Approve once";
  if (choice === "session") return "Approve for this session";
  if (choice === "always") return "Always approve";
  return "Reject";
}

export function ApprovalCard({
  event,
  pending,
  responded,
  onRespond,
}: {
  event: DeskRunEvent;
  pending: boolean;
  responded?: ApprovalChoice | undefined;
  onRespond: (choice: ApprovalChoice) => void;
}) {
  const choices: ApprovalChoice[] = event.choices?.length
    ? event.choices
    : ["once", "deny"];
  return (
    <section aria-label="Hermes approval request" className="approval-card">
      <strong>Approval needed</strong>
      <p>
        {event.description ??
          event.preview ??
          "Hermes needs your decision before continuing."}
      </p>
      {responded ? (
        <p role="status">
          {responded === "deny"
            ? "Rejected. Hermes is finishing the run."
            : `${approvalLabel(responded)} sent. Hermes resumed the run.`}
        </p>
      ) : (
        <div className="approval-actions">
          {choices.map((choice) => (
            <Button
              disabled={pending}
              key={choice}
              loading={pending}
              onClick={() => onRespond(choice)}
              size="sm"
              variant={
                choice === "deny"
                  ? "danger"
                  : choice === "once"
                    ? "primary"
                    : "secondary"
              }
            >
              {approvalLabel(choice)}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ActivityEvent({ event }: { event: DeskRunEvent }) {
  let label = event.event.replaceAll(".", " ");
  if (event.event === "tool.started") label = `Using ${event.tool ?? "a tool"}`;
  if (event.event === "tool.completed")
    label = event.error
      ? `${event.tool ?? "Tool"} failed`
      : `Used ${event.tool ?? "a tool"}`;
  if (event.event === "subagent.start") label = "Delegated a task";
  if (event.event === "subagent.complete") label = "Delegated task completed";
  if (event.event === "approval.responded")
    label =
      event.choice === "deny"
        ? "Approval rejected"
        : "Approval accepted; run resumed";
  if (event.event === "reasoning.available") label = "Reasoning available";
  const detail = event.summary ?? event.goal ?? event.preview ?? event.text;
  return (
    <li>
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : null}
    </li>
  );
}
