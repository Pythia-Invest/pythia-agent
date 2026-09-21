"use client";

import { cn } from "@pythia/ui";
import type { ReactNode } from "react";
import { InvestmentSearch } from "./investment-search";

export interface TopBarProps {
  actions?: ReactNode;
  className?: string;
  onQueryChange: (query: string) => void;
  query: string;
  title: string;
}

/** Shared investment search also retains the shell's existing chat filter. */
export function TopBar({
  actions,
  className,
  onQueryChange,
  query,
  title,
}: TopBarProps) {
  return (
    <search
      className={cn(
        "flex h-12 flex-none items-center gap-2 border-border/50 border-b bg-canvas pr-3 pl-4 min-[600px]:gap-4",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate font-semibold text-body text-foreground">
        {title}
      </span>
      <InvestmentSearch query={query} onQueryChange={onQueryChange} />
      <div className="flex min-w-max flex-1 items-center justify-end gap-1">
        {actions}
      </div>
    </search>
  );
}
