"use client";

/** The rows inside a turn's activity: agents, plans, tools and their details. */

import { cn } from "@pythia/ui";
import type { DynamicToolUIPart } from "ai";
import {
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleDashed,
  CircleDot,
  Copy,
  LoaderCircle,
  Minus,
  Square,
} from "lucide-react";
import { useContext, useId, useState } from "react";
import type { PlanItem, WorkAgent } from "@/work/types";
import { AGENT_STATUS, agentTitle } from "./agent-presentation";
import { toolCopy, toolView } from "./tool-copy";
import { type ToolDetail, toolDetail } from "./tool-detail";
import { toolOutcome } from "./turn-model";
import { TurnWork } from "./turn-work";

export function AgentMark({ status }: { status: WorkAgent["status"] }) {
  const Icon =
    status === "running"
      ? LoaderCircle
      : status === "failed"
        ? CircleAlert
        : status === "stopped"
          ? Square
          : status === "unknown"
            ? CircleDashed
            : Check;
  return (
    <Icon
      role="img"
      aria-label={AGENT_STATUS[status]}
      className={cn(
        "size-3.5 shrink-0 stroke-[1.75]",
        status === "running" &&
          "animate-spin-slow text-foreground-secondary motion-reduce:animate-none",
        status === "failed" ? "text-error" : "text-foreground-disabled",
        status === "stopped" && "size-3",
      )}
    />
  );
}

export function AgentRows({
  agents,
  limit = 3,
}: {
  agents: readonly WorkAgent[];
  limit?: number;
}) {
  const work = useContext(TurnWork);
  if (!agents.length) return null;
  const shown = agents.slice(0, limit);
  return (
    <ul className="m-0 grid list-none gap-px p-0" data-slot="turn-agents">
      {shown.map((agent) => (
        <li key={agent.id} className="min-w-0 motion-safe:animate-enter">
          <button
            type="button"
            disabled={!work}
            onClick={() => work?.onSelectAgent(agent)}
            title={agentTitle(agent)}
            className="motion-fast group flex w-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 py-0.5 text-start text-body leading-ui focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default"
          >
            <AgentMark status={agent.status} />
            <span className="min-w-0 truncate text-foreground-secondary transition-colors group-hover:text-foreground">
              {agentTitle(agent)}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-foreground-disabled"
            />
          </button>
        </li>
      ))}
      {agents.length > limit ? (
        <li>
          <button
            type="button"
            onClick={() => work?.onShowAllAgents()}
            className="motion-fast cursor-pointer border-0 bg-transparent p-0 py-0.5 text-body text-foreground-secondary leading-ui transition-colors hover:text-foreground"
          >
            and {agents.length - limit} more
          </button>
        </li>
      ) : null}
    </ul>
  );
}

export function PlanList({ items }: { items: readonly PlanItem[] }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0" data-slot="turn-plan">
      {items.map((item) => {
        const Icon =
          item.status === "completed"
            ? Check
            : item.status === "in_progress"
              ? CircleDot
              : item.status === "cancelled"
                ? Minus
                : Circle;
        return (
          <li
            key={item.id}
            className="flex min-w-0 items-start gap-2 text-body leading-ui"
            data-state={item.status}
          >
            <Icon
              aria-label={
                item.status === "completed"
                  ? "Done"
                  : item.status === "in_progress"
                    ? "In progress"
                    : item.status === "cancelled"
                      ? "Dropped"
                      : "To do"
              }
              role="img"
              className={cn(
                "mt-0.75 size-3.5 shrink-0 stroke-[1.75]",
                item.status === "in_progress"
                  ? "text-foreground"
                  : "text-foreground-disabled",
              )}
            />
            <span
              className={cn(
                "min-w-0 break-words",
                item.status === "in_progress"
                  ? "text-foreground"
                  : "text-foreground-secondary",
                item.status === "cancelled" && "line-through",
              )}
            >
              {item.content}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Code the agent ran and what it printed, in one quiet panel: the code in
 * normal text, the output beneath it in lighter text. Copy appears on hover.
 */
export function CodeBlock({ code, output }: { code: string; output?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative min-w-0 rounded-container bg-subtle px-3 py-2 pe-9 font-mono text-xs leading-reading">
      <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words text-foreground">
        {code}
      </pre>
      {output ? (
        <pre
          data-slot="activity-output"
          className="m-0 mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-foreground-secondary"
        >
          {output}
        </pre>
      ) : null}
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy code"}
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="motion-fast absolute top-1.5 right-1.5 grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-foreground-secondary opacity-0 transition-opacity hover:bg-interaction-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/code:opacity-100"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/** Long output keeps its start; the rest is summarised, never silently cut. */
export function clip(output: string, lines = 60) {
  const all = output.split("\n");
  if (all.length <= lines) return output;
  return `${all.slice(0, lines).join("\n")}\n… ${all.length - lines} more lines`;
}

export function Detail({ detail }: { detail: ToolDetail }) {
  switch (detail.kind) {
    case "links":
      return (
        <ul className="m-0 grid list-none gap-1 p-0">
          {detail.links.map((link) => (
            <li key={link.url} className="min-w-0">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group/link grid min-w-0 no-underline"
              >
                <span className="truncate text-foreground group-hover/link:underline">
                  {link.title}
                </span>
                <span className="truncate text-foreground-disabled text-xs">
                  {link.site}
                </span>
              </a>
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <CodeBlock
          code={detail.code}
          {...(detail.output ? { output: clip(detail.output) } : {})}
        />
      );
    case "files":
      return (
        <ul className="m-0 grid list-none gap-0.5 p-0 text-foreground-secondary">
          {detail.files.map((file) => (
            <li key={file} className="truncate">
              {file}
            </li>
          ))}
        </ul>
      );
    case "message":
      return (
        <p className="m-0 whitespace-pre-wrap break-words text-foreground-secondary">
          {detail.text}
        </p>
      );
  }
}

export function ToolRow({
  part,
  runActive,
}: {
  part: DynamicToolUIPart;
  runActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const view = toolView(part);
  const copy = toolCopy(view);
  const outcome = toolOutcome(part, runActive);
  const failed = outcome === "failed";
  const label = failed
    ? copy.failed || copy.done
    : outcome === "running"
      ? copy.running
      : copy.done;
  const detail = toolDetail(view, part, failed);
  return (
    <li className="min-w-0" data-slot="activity-row" data-state={outcome}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen(!open)}
        className="motion-fast group flex min-w-0 max-w-full cursor-pointer items-start border-0 bg-transparent p-0 py-0.5 text-start text-body text-foreground-secondary leading-ui transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="min-w-0 break-words">
          {label}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "motion-fast ms-1 inline size-3.5 -translate-y-px text-foreground-disabled transition-[transform,opacity]",
              open && "rotate-90",
            )}
          />
        </span>
      </button>
      {open ? (
        <div id={detailId} className="min-w-0 pt-1 pb-2 text-body leading-ui">
          <Detail detail={detail} />
        </div>
      ) : null}
    </li>
  );
}
