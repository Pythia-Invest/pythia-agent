"use client";

import { cn, Skeleton } from "@pythia/ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/*
 * Settings layout pieces, after Hermes Desktop's settings primitives
 * (apps/desktop/src/app/settings/primitives.tsx, NousResearch/hermes-agent,
 * MIT): flat rows with the label on the left and the control on the right,
 * stacking when their pane is narrow.
 */

export function ListRow({
  title,
  description,
  hint,
  action,
  below,
  id,
  wide = false,
  inline = false,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  below?: ReactNode;
  id?: string;
  /** The control takes the full width under the label. */
  wide?: boolean;
  /** A small control, such as a switch, stays beside the label at any width. */
  inline?: boolean;
  className?: string;
}) {
  return (
    // Container-queried so a narrow pane stacks instead of squeezing.
    // A row chosen from search is marked for a moment with data-highlight.
    <div
      className={cn(
        "@container motion-standard -mx-2 rounded-control px-2 transition-colors data-[highlight=true]:bg-interaction-active",
        className,
      )}
      id={id}
      data-slot="list-row"
    >
      <div
        className={cn(
          "grid gap-3 py-3",
          inline
            ? "grid-cols-[minmax(0,1fr)_auto] items-center"
            : !wide &&
                "@2xl:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] @2xl:items-center",
        )}
      >
        <div className="min-w-0">
          <div className="font-medium text-body text-foreground">{title}</div>
          {description ? (
            <div className="mt-1 text-foreground-secondary text-xs leading-4">
              {description}
            </div>
          ) : null}
          {hint ? (
            <div className="mt-1 font-mono text-[0.68rem] text-foreground-disabled">
              {hint}
            </div>
          ) : null}
          {below}
        </div>
        {action ? (
          // The control fills its column; one narrower than it sits at the end.
          <div
            className={cn(
              "flex min-w-0",
              inline ? "justify-end" : !wide && "@2xl:justify-end",
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A titled group on a page. */
export function SettingsSection({
  icon: Icon,
  title,
  aside,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6" aria-label={title}>
      <div className="mb-2.5 flex items-center gap-2 pt-2 font-medium text-body">
        {Icon ? (
          <Icon
            aria-hidden="true"
            className="size-4 flex-none stroke-[1.6] text-foreground-secondary"
          />
        ) : null}
        <h3 className="m-0 font-medium text-body">{title}</h3>
        {aside ? (
          <div className="ml-auto flex min-w-0 items-center">{aside}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function ListRowSkeleton() {
  return (
    <div className="@container">
      <div className="grid @2xl:grid-cols-[minmax(0,1fr)_minmax(15rem,22rem)] @2xl:items-center gap-3 py-3">
        <div className="grid gap-1.5">
          <Skeleton className="h-3.5 w-40 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 @2xl:w-72 w-full @2xl:justify-self-end" />
      </div>
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-1" role="status" aria-busy="true">
      <span className="sr-only">Loading settings</span>
      {Array.from({ length: rows }, (_, row) => (
        <ListRowSkeleton key={row} />
      ))}
    </div>
  );
}
