"use client";

import { cn } from "@pythia/ui";
import { ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { formatElapsed } from "./activity-timer";
import type { ToolOutcome } from "./turn-model";

/**
 * Transcript scaffolding: the quiet lines around a reply that say what the
 * agent did rather than what it said. Per the design direction, machine work
 * is legible without spectacle: one muted type size, plain-language labels,
 * restrained indeterminate activity, and disclosure affordances that are
 * visible before hover. Every line shares these so they read as one kind of
 * thing.
 */
export const SCAFFOLD_LABEL_CLASS =
  "min-w-0 truncate text-foreground-secondary text-xs leading-ui";
/**
 * The live row is the one thing a reader is waiting on, so it is set at body
 * size while the settled record of the same work stays at the quiet step.
 */
export const SCAFFOLD_LIVE_LABEL_CLASS =
  "min-w-0 truncate text-body text-foreground-secondary leading-ui";
export const SCAFFOLD_META_CLASS =
  "shrink-0 text-foreground-secondary text-xs leading-ui numeric";
/** The rail a settled turn's steps hang from. */
export const SCAFFOLD_RAIL_CLASS =
  "m-0 ms-1 grid list-none gap-px border-border border-s p-0 ps-2.5";

export function ScaffoldBlock({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Record<
  `data-${string}`,
  string | undefined
>) {
  return (
    <div
      className={cn("min-w-0 max-w-full", className)}
      data-conversation-scaffold=""
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Restrained indeterminate activity, always paired with a named label.
 *
 * A signal dot rather than a spinner: a spinner claims a duration it does not
 * know, and this is the same marker the tab strip and the composer use for
 * "work is happening", so the three read as one language.
 */
export function ActivityGlyph({ className }: { className?: string }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 animate-pulse rounded-pill bg-signal motion-reduce:animate-none",
          className,
        )}
      />
    </span>
  );
}

/**
 * Where a recorded step got to. Its shape carries the outcome, so the rail
 * still reads without colour: filled done, hollow unconfirmed, cross failed.
 */
export function StepGlyph({ state }: { state: ToolOutcome }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1.5 grid size-2.5 flex-none place-items-center",
        state === "failed" ? "text-error" : "text-foreground-disabled",
      )}
    >
      {state === "failed" ? (
        <X className="size-2.5 stroke-[2.2]" />
      ) : state === "running" ? (
        <span className="size-1.5 animate-pulse rounded-pill bg-signal motion-reduce:animate-none" />
      ) : state === "unconfirmed" ? (
        <span className="size-1.5 rounded-pill border border-current" />
      ) : (
        <span className="size-1 rounded-pill bg-current" />
      )}
    </span>
  );
}

export function TimerText({
  seconds,
  className,
}: {
  seconds: number;
  className?: string;
}) {
  return (
    <span aria-live="off" className={cn(SCAFFOLD_META_CLASS, className)}>
      {formatElapsed(seconds)}
    </span>
  );
}

/**
 * One compact activity row. The glyph, label, timer and caret share the same
 * fixed-height center line so streaming content cannot make them jump.
 */
export function DisclosureRow({
  children,
  onToggle,
  open = false,
  trailing,
}: {
  children: ReactNode;
  onToggle?: (() => void) | undefined;
  open?: boolean;
  trailing?: ReactNode;
}) {
  if (!onToggle)
    return (
      <div className="flex h-7 min-w-0 items-center gap-2" role="status">
        {children}
        {trailing ? (
          <span className="flex items-center">{trailing}</span>
        ) : null}
      </div>
    );
  return (
    <button
      aria-expanded={open}
      className="motion-fast -mx-1.5 flex h-6.5 min-w-0 max-w-full cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-start text-xs transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      onClick={onToggle}
      type="button"
    >
      {children}
      {trailing ? <span className="flex items-center">{trailing}</span> : null}
      <span className="grid size-4 shrink-0 place-items-center">
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "motion-fast size-3 text-foreground-disabled transition-transform",
            open && "rotate-90",
          )}
        />
      </span>
    </button>
  );
}
