"use client";

import { cn } from "@pythia/ui";
import { RotateCcw, TriangleAlert, WifiOff } from "lucide-react";
import type { StreamConnection } from "@/client/hermes-transport";

const CONNECTION_COPY: Record<
  Exclude<StreamConnection, "ok">,
  { label: string; detail: string }
> = {
  reconnecting: {
    label: "Live activity interrupted",
    detail: "Checking run status.",
  },
  disconnected: {
    label: "Connection lost",
    detail: "The run was not cancelled. Reload to check its status.",
  },
};

/**
 * Whether the browser can still see the run — not whether the run is healthy.
 *
 * Hermes keeps working when the event stream drops, so this says what is
 * actually known rather than implying a failure that has not happened.
 */
export function ConnectionNote({ state }: { state: StreamConnection }) {
  if (state === "ok") return null;
  const copy = CONNECTION_COPY[state];
  return (
    <div
      className="flex min-w-0 items-center gap-2 px-1 text-foreground-secondary text-xs"
      data-slot="connection-note"
      data-state={state}
      role="status"
    >
      <WifiOff aria-hidden="true" className="size-3.5 flex-none stroke-[1.6]" />
      <span className="flex-none text-foreground">{copy.label}</span>
      <span className="min-w-0 flex-1 truncate">{copy.detail}</span>
    </div>
  );
}

/** A rule the composer will not let you past, said where you will act on it. */
export function ComposerNote({ children }: { children: string }) {
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 px-1 text-error text-xs"
      data-slot="composer-note"
      role="alert"
    >
      <TriangleAlert
        aria-hidden="true"
        className="size-3 flex-none stroke-[1.6]"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * A run that did not produce an answer.
 *
 * The cause comes first in the reader's own words, the identifiers that make
 * it reportable sit under it, and the retry is where the eye already is.
 */
export function ChatError({
  className,
  context,
  message,
  onRetry,
}: {
  className?: string | undefined;
  context?: string | undefined;
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-container border border-border bg-raised px-3 py-2.5",
        className,
      )}
      data-slot="chat-error"
      role="alert"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-3.5 flex-none stroke-[1.6] text-error"
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="min-w-0 whitespace-pre-wrap break-words text-body text-foreground leading-ui">
          {message}
        </span>
        {context ? (
          <span className="text-foreground-secondary text-xs">{context}</span>
        ) : null}
      </div>
      {onRetry ? (
        <button
          className="motion-fast -me-1 flex h-6.5 flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 font-medium text-foreground text-xs transition-colors hover:bg-interaction-hover"
          onClick={onRetry}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-3 stroke-[1.6]" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * The model control when there is no catalog to choose from.
 *
 * Rendering nothing would say the picker does not exist; this says it could
 * not be loaded, and offers the one action that might fix it.
 */
export function CatalogError({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 ps-1 text-foreground-secondary text-xs"
      data-slot="catalog-error"
      role="status"
    >
      <TriangleAlert
        aria-hidden="true"
        className="size-3 flex-none stroke-[1.6] text-error"
      />
      <span className="min-w-0 truncate">Model catalog unavailable</span>
      <button
        className="motion-fast flex h-5 flex-none cursor-pointer items-center rounded-sm border-0 bg-transparent px-1.5 font-medium text-foreground text-xs transition-colors hover:bg-interaction-hover disabled:opacity-disabled"
        disabled={retrying}
        onClick={onRetry}
        type="button"
      >
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </span>
  );
}

/**
 * A run that ended without an answer but without a fault either — stopped, or
 * continuing elsewhere. Quiet, and never dressed as an error.
 */
export function ChatNote({ children }: { children: string }) {
  return (
    <div
      className="flex items-center gap-2 text-foreground-secondary text-xs"
      data-slot="chat-note"
    >
      <span
        aria-hidden="true"
        className="size-1.5 flex-none rounded-pill border border-current"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
