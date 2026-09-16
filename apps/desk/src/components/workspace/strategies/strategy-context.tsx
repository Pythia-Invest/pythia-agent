"use client";

import { Button } from "@pythia/ui";
import { useWorkspaceEntry } from "@/client/queries";
import type {
  NativeSessionContext,
  StrategyReference,
} from "@/workspace/session-context";
import {
  readableStrategyBrief,
  strategyName,
  strategyTitle,
} from "@/workspace/strategies";
import type { WorkspaceEntry } from "@/workspace/types";
import type { WorkspaceLocation } from "../reader-context";
import { WorkspaceLink } from "../workspace-link";

export function StrategyBriefAction({
  path,
  entry,
  text,
  pending,
  onOpen,
  onStartStrategy,
}: {
  path: string;
  entry?: WorkspaceEntry | undefined;
  text?: string | undefined;
  pending?: boolean | undefined;
  onOpen: (location: WorkspaceLocation) => void;
  onStartStrategy: (briefPath: string) => void;
}) {
  if (!strategyName(path)) return null;
  const available =
    readableStrategyBrief(entry) && text !== undefined && !pending;
  return (
    <div
      data-slot="strategy-brief-action"
      className="flex flex-wrap items-center gap-3 border-border border-b px-4 py-2 text-xs"
    >
      <span className="min-w-0 flex-1 break-words">
        Strategy: {strategyTitle(path, text)}
      </span>
      <Button
        size="sm"
        variant="secondary"
        disabled={!available}
        onClick={() => onStartStrategy(path)}
      >
        Start chat for strategy
      </Button>
      {!available ? (
        <span role="status" className="w-full text-foreground-secondary">
          {pending ? "Reading strategy brief…" : "Strategy brief unavailable. "}
          {!pending ? (
            <WorkspaceLink
              location={{ path: path.split("/").slice(0, -1).join("/") }}
              onOpen={onOpen}
            >
              Browse its folder
            </WorkspaceLink>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function ResolvedStrategy({
  reference,
  onOpen,
}: {
  reference: StrategyReference;
  onOpen?: ((location: WorkspaceLocation) => void) | undefined;
}) {
  const brief = useWorkspaceEntry(reference.briefPath);
  const missing =
    brief.isError || (brief.data && !readableStrategyBrief(brief.data));
  return (
    <div
      data-slot="chat-strategy-context"
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-foreground-secondary text-xs"
    >
      <span>Started with</span>
      <span className="text-primary underline">
        <WorkspaceLink location={{ path: reference.briefPath }} onOpen={onOpen}>
          {strategyTitle(reference.briefPath)}
        </WorkspaceLink>
      </span>
      {missing ? (
        <span role="status">
          Brief unavailable; the original reference is retained.
        </span>
      ) : null}
    </div>
  );
}

/** Provenance comes from native history. Browsing another file never changes it. */
export function StrategyChatContext({
  context,
  pending,
  onOpen,
}: {
  context?: NativeSessionContext | undefined;
  pending?: boolean | undefined;
  onOpen?: ((location: WorkspaceLocation) => void) | undefined;
}) {
  if (!context)
    return pending ? (
      <p role="status" className="text-foreground-secondary text-xs">
        Checking conversation context…
      </p>
    ) : null;
  if (context.scope.status === "none") return null;
  if (context.scope.status === "unresolved")
    return (
      <p role="status" className="text-foreground-secondary text-xs">
        Strategy context could not be verified for this conversation.
      </p>
    );
  return (
    <ResolvedStrategy reference={context.scope.reference} onOpen={onOpen} />
  );
}
