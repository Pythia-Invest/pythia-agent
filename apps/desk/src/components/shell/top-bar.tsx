"use client";

import { cn } from "@pythia/ui";
import { Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface TopBarProps {
  /** Rendered after the search field, at the right edge. */
  actions?: ReactNode;
  className?: string;
  onQueryChange: (query: string) => void;
  query: string;
  title: string;
}

/**
 * The bar above every surface: where you are, one search, surface actions.
 *
 * The search box is the shell's own; what it searches belongs to the surface
 * underneath, which passes `query` down. It is not wired to a global index —
 * there is no such index yet — so today it filters the chat list.
 */
export function TopBar({
  actions,
  className,
  onQueryChange,
  query,
  title,
}: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The hint is only shown once the shortcut is actually listening.
  const [shortcutReady, setShortcutReady] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
        return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    setShortcutReady(true);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <search
      className={cn(
        "flex h-12 flex-none items-center gap-4 border-border border-b bg-canvas pr-3 pl-4",
        className,
      )}
    >
      {/* Equal flexible gutters either side keep the field centred in the bar
          whatever the title and the actions happen to measure. */}
      <span className="min-w-0 flex-1 truncate font-semibold text-body text-foreground">
        {title}
      </span>
      <label className="motion-fast flex h-8 w-104 max-w-[45%] flex-none cursor-text items-center gap-2 rounded-control border border-border bg-subtle px-2.5 text-foreground-secondary transition-colors focus-within:border-border-strong focus-within:bg-raised focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 hover:border-border-strong">
        <Search
          aria-hidden="true"
          className="size-3.5 flex-none stroke-[1.6]"
        />
        <input
          aria-label="Search"
          className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search names, filings, chats"
          ref={inputRef}
          type="search"
          value={query}
        />
        {shortcutReady ? (
          <kbd className="flex-none font-sans text-foreground-secondary text-xs">
            ⌘K
          </kbd>
        ) : null}
      </label>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {actions}
      </div>
    </search>
  );
}
