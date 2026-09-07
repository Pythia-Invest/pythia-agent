"use client";

import { ActivityIndicator, Alert, Button, cn, Collapsible } from "@pythia/ui";
import type { DynamicToolUIPart, ReasoningUIPart } from "ai";
import { Check, ChevronDown, CircleAlert, Wrench } from "lucide-react";
import { Streamdown } from "streamdown";
import type { ApprovalData, RunStatusData } from "@/client/chat-message";
import type { ApprovalChoice } from "@/server/types";

/** Assistant prose. Streamdown repairs unterminated markdown while streaming. */
export function AssistantText({
  streaming,
  text,
}: {
  streaming: boolean;
  text: string;
}) {
  return (
    <Streamdown
      className="min-w-0 text-foreground text-reading leading-reading [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_a]:text-primary [&_a]:underline [&_code]:rounded-control [&_code]:bg-subtle [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:font-semibold [&_h1]:text-xl [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-lg [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:ps-6 [&_p]:my-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-container [&_pre]:border [&_pre]:border-border [&_pre]:bg-subtle [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-subtle [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-start [&_ul]:my-3 [&_ul]:list-disc [&_ul]:ps-6"
      isAnimating={streaming}
      mode={streaming ? "streaming" : "static"}
    >
      {text}
    </Streamdown>
  );
}

export function ReasoningBlock({ part }: { part: ReasoningUIPart }) {
  return (
    <Collapsible.Root className="border-0 bg-transparent">
      <Collapsible.Trigger className="h-auto min-h-0 gap-1 px-0 py-1 font-normal text-foreground-secondary text-sm hover:bg-transparent hover:text-foreground">
        <span>Thought process</span>
        <ChevronDown
          aria-hidden="true"
          className="motion-fast size-4 transition-transform group-data-panel-open:rotate-180"
        />
      </Collapsible.Trigger>
      <Collapsible.Panel className="border-0 px-0 py-1">
        <p className="m-0 whitespace-pre-wrap border-border border-s-2 ps-3 text-foreground-secondary text-sm leading-reading">
          {part.text}
        </p>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function humanTool(name: string) {
  return name.replaceAll(/[_-]+/g, " ");
}

export function ToolRow({ part }: { part: DynamicToolUIPart }) {
  const running =
    part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const preview =
    part.input && typeof part.input === "object" && "preview" in part.input
      ? String((part.input as { preview?: unknown }).preview ?? "")
      : "";
  return (
    <div
      className="flex min-w-0 items-center gap-2 py-1 text-foreground-secondary text-sm"
      data-slot="tool-row"
      data-state={part.state}
    >
      {running ? (
        <ActivityIndicator
          label={`Running ${humanTool(part.toolName)}`}
          size="small"
          visuallyHiddenLabel
        />
      ) : failed ? (
        <CircleAlert aria-hidden="true" className="size-4 text-error" />
      ) : (
        <Check aria-hidden="true" className="size-4" />
      )}
      <Wrench aria-hidden="true" className="size-3.5 flex-none opacity-70" />
      <span className="flex-none">{humanTool(part.toolName)}</span>
      {preview ? (
        <span className="min-w-0 truncate text-foreground-disabled">
          {preview}
        </span>
      ) : null}
    </div>
  );
}

const approvalLabels: Record<ApprovalChoice, string> = {
  once: "Allow once",
  session: "Allow for this chat",
  always: "Always allow",
  deny: "Deny",
};

export function ApprovalCard({
  data,
  onRespond,
  pending,
}: {
  data: ApprovalData;
  onRespond: (choice: ApprovalChoice) => void;
  pending: boolean;
}) {
  const responded = data.responded;
  return (
    <section
      aria-label="Approval request"
      className="grid gap-3 rounded-container border border-warning-border bg-warning-surface p-4"
      data-slot="approval-card"
      data-state={responded ? "responded" : "request"}
    >
      <div className="grid gap-1">
        <p className="m-0 font-medium text-foreground text-sm">
          Pythia is asking permission to continue
        </p>
        {data.description ? (
          <p className="m-0 whitespace-pre-wrap text-foreground-secondary text-sm leading-reading">
            {data.description}
          </p>
        ) : null}
      </div>
      {responded ? (
        <p className="m-0 text-foreground-secondary text-sm">
          {responded === "deny" ? "Denied." : `${approvalLabels[responded]}.`}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.choices.map((choice) => (
            <Button
              disabled={pending}
              key={choice}
              onClick={() => onRespond(choice)}
              size="sm"
              variant={
                choice === "deny"
                  ? "secondary"
                  : choice === "once"
                    ? "primary"
                    : "secondary"
              }
            >
              {approvalLabels[choice]}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

const runStatusText: Record<RunStatusData["state"], string> = {
  failed: "Pythia could not finish this reply.",
  cancelled: "Stopped.",
  disconnected: "The connection to this reply was lost.",
};

export function RunStatusNote({ data }: { data: RunStatusData }) {
  if (data.state === "cancelled") {
    return (
      <p
        className="m-0 text-foreground-disabled text-sm"
        data-slot="run-status"
        data-state={data.state}
      >
        {runStatusText.cancelled}
      </p>
    );
  }
  return (
    <Alert
      className={cn("my-1")}
      data-slot="run-status"
      data-state={data.state}
      title={runStatusText[data.state]}
      tone={data.state === "failed" ? "error" : "warning"}
    >
      {data.message}
    </Alert>
  );
}
