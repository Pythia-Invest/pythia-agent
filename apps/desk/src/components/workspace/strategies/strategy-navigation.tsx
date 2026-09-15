"use client";

import { Button } from "@pythia/ui";
import { useWorkspaceEntry, useWorkspaceList } from "@/client/queries";
import {
  readableStrategyBrief,
  strategyBriefPath,
} from "@/workspace/strategies";
import type { WorkspaceEntry } from "@/workspace/types";
import type { WorkspaceLocation } from "../reader-context";
import { WorkspaceLink } from "../workspace-link";

// Metadata requests stay bounded even when an investor has many folders.
const VISIBLE_STRATEGIES = 12;
type Actions = {
  onOpen: (location: WorkspaceLocation) => void;
  onStartStrategy: (briefPath: string) => void;
};

function StrategyFolder({
  entry,
  onOpen,
  onStartStrategy,
}: Actions & { entry: WorkspaceEntry }) {
  const path = strategyBriefPath(entry.path) as string;
  const brief = useWorkspaceEntry(path);
  const available = !brief.isError && readableStrategyBrief(brief.data);
  return (
    <li className="flex flex-wrap items-center gap-2 border-border border-b py-2">
      <div className="min-w-0 flex-1">
        <span className="break-words text-body text-primary underline">
          <WorkspaceLink
            location={{ path: available ? path : entry.path }}
            onOpen={onOpen}
          >
            {entry.name}
          </WorkspaceLink>
        </span>
        <p className="mt-1 text-foreground-secondary text-xs">
          {brief.isPending
            ? "Checking strategy brief…"
            : available
              ? "Shared research, separate goals and reasoning."
              : "Strategy brief unavailable. You can still browse this folder."}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={!available}
        onClick={() => onStartStrategy(path)}
        aria-label={`Start chat for ${entry.name}`}
      >
        Start chat
      </Button>
    </li>
  );
}

/** Optional named areas alongside ordinary research, never a Workspace gate. */
export function StrategyNavigation({ onOpen, onStartStrategy }: Actions) {
  const root = useWorkspaceList("");
  const hasFolder =
    root.data?.entries.some(
      (entry) => entry.path === "strategies" && entry.kind === "directory",
    ) ?? false;
  const strategies = useWorkspaceList("strategies", hasFolder);
  const candidates =
    strategies.data?.entries.filter(
      (entry) => entry.kind === "directory" && strategyBriefPath(entry.path),
    ) ?? [];
  if (root.isPending || root.isError) return null;
  return (
    <section
      aria-label="Optional strategies"
      data-slot="workspace-strategies"
      className="mt-6 max-w-2xl border-border border-t pt-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-body">Strategies</h2>
        {hasFolder ? (
          <span className="text-primary text-xs underline">
            <WorkspaceLink location={{ path: "strategies" }} onOpen={onOpen}>
              Browse folders
            </WorkspaceLink>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-body text-foreground-secondary">
        Optional spaces for different goals and assumptions. All research and
        general chats remain available without one.
      </p>
      {(!hasFolder && !root.data?.partial) ||
      (hasFolder &&
        !strategies.isPending &&
        !strategies.isError &&
        !candidates.length) ? (
        <p className="mt-3 text-foreground-secondary text-xs">
          Ask Pythia to organize a strategy when a separate line of reasoning
          would help.
        </p>
      ) : null}
      {!hasFolder && root.data?.partial ? (
        <p role="status" className="mt-3 text-xs">
          Strategy discovery is partial.{" "}
          <WorkspaceLink location={{ path: "strategies" }} onOpen={onOpen}>
            Check the strategies folder
          </WorkspaceLink>
          .
        </p>
      ) : null}
      {hasFolder && strategies.isPending ? (
        <p role="status" className="mt-3 text-xs">
          Loading strategies…
        </p>
      ) : null}
      {hasFolder && strategies.isError ? (
        <p role="status" className="mt-3 text-xs">
          Strategy folders could not be read. Your other research is still
          available.
        </p>
      ) : null}
      <ul className="mt-3 list-none p-0">
        {candidates.slice(0, VISIBLE_STRATEGIES).map((entry) => (
          <StrategyFolder
            key={entry.path}
            entry={entry}
            onOpen={onOpen}
            onStartStrategy={onStartStrategy}
          />
        ))}
      </ul>
      {strategies.data?.partial || candidates.length > VISIBLE_STRATEGIES ? (
        <p role="status" className="mt-2 text-foreground-secondary text-xs">
          Some strategy folders are not shown here. Browse folders to find the
          rest.
        </p>
      ) : null}
    </section>
  );
}
