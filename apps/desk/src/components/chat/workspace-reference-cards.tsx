"use client";
import Link from "next/link";
import { IconButton } from "@pythia/ui";
import { X } from "lucide-react";
import { WorkspaceLink } from "@/components/workspace/workspace-link";
import type { WorkspaceContext } from "@/workspace/references";
export function WorkspaceReferenceCards({
  context,
  onChange,
}: {
  context?: WorkspaceContext | undefined;
  onChange?: (context: WorkspaceContext) => void;
}) {
  if (!context) return null;
  const strategy = context.startStrategyPath ?? context.strategy?.briefPath;
  if (!context.references.length && !strategy && !context.previousSessionId)
    return null;
  return (
    <div
      data-slot="workspace-reference-cards"
      className="flex flex-wrap gap-1 text-xs"
    >
      {context.references.map((file, index) => (
        <span
          className="flex max-w-full items-center gap-1 rounded-control border border-border bg-canvas px-2 py-1"
          key={`${file.path}:${index}`}
        >
          <span
            className="min-w-0 truncate"
            title={file.selection || file.path}
          >
            <WorkspaceLink
              location={{ path: file.path, heading: file.heading }}
            >
              {file.path.split("/").at(-1)}
              {file.heading ? ` › ${file.heading}` : ""}
              {file.selection ? " · selection" : ""}
            </WorkspaceLink>
          </span>
          {onChange ? (
            <IconButton
              type="button"
              label={`Remove reference ${file.path}`}
              size="sm"
              onClick={() =>
                onChange({
                  ...context,
                  references: context.references.filter((_, i) => i !== index),
                })
              }
            >
              <X />
            </IconButton>
          ) : null}
        </span>
      ))}
      {strategy ? (
        <span className="flex items-center gap-1 rounded-control border border-border bg-canvas px-2 py-1">
          {context.startStrategyPath ? "Start with: " : "Started with: "}
          <WorkspaceLink location={{ path: strategy }}>
            {strategy.split("/")[1]}
          </WorkspaceLink>
          {onChange ? (
            <IconButton
              type="button"
              label="Use a general chat"
              size="sm"
              onClick={() => {
                const {
                  strategy: _strategy,
                  startStrategyPath: _path,
                  ...rest
                } = context;
                onChange(rest);
              }}
            >
              <X />
            </IconButton>
          ) : null}
        </span>
      ) : null}
      {context.previousSessionId ? (
        <span className="flex items-center gap-1 rounded-control border border-border bg-canvas px-2 py-1">
          <Link href={`/c/${encodeURIComponent(context.previousSessionId)}`}>
            Previous conversation
          </Link>
          {onChange ? (
            <IconButton
              type="button"
              label="Remove previous conversation"
              size="sm"
              onClick={() => {
                const { previousSessionId: _previous, ...rest } = context;
                onChange(rest);
              }}
            >
              <X />
            </IconButton>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
