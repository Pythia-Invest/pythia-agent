"use client";

import { Button, cn, IconButton } from "@pythia/ui";
import { Search } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface TopBarProps {
  /** Rendered after the search field, at the right edge. */
  actions?: ReactNode;
  /** Rendered before the title: the menu button on phones. */
  leading?: ReactNode;
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
  leading,
  className,
  onQueryChange,
  query,
  title,
}: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The hint is only shown once the shortcut is actually listening.
  const [shortcutReady, setShortcutReady] = useState(false);
  // On a phone the field waits behind a search button and, once open, takes
  // the whole bar until it is cancelled.
  const [expanded, setExpanded] = useState(false);
  const open = expanded || query.length > 0;
  const cancel = () => {
    onQueryChange("");
    setExpanded(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
        return;
      event.preventDefault();
      // On a narrow screen the field may be folded behind its button.
      setExpanded(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    window.addEventListener("keydown", onKeyDown);
    setShortcutReady(true);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <search
      className={cn(
        "flex h-12 flex-none items-center gap-2 border-border/50 border-b bg-canvas px-2 min-[900px]:gap-4 min-[900px]:pr-3 min-[900px]:pl-4",
        className,
      )}
    >
      <span className={cn("contents", open && "max-[899px]:hidden")}>
        {leading}
      </span>
      {/* Equal flexible gutters either side keep the field centred in the bar
          whatever the title and the actions happen to measure. */}
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-semibold text-body text-foreground",
          open && "max-[899px]:hidden",
        )}
      >
        {title}
      </span>
      <label
        className={cn(
          "motion-fast flex h-8 w-104 max-w-[45%] flex-none cursor-text items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-foreground-secondary transition-colors focus-within:border-border-strong focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 hover:border-border-strong",
          open
            ? "max-[899px]:w-auto max-[899px]:max-w-none max-[899px]:flex-1"
            : "max-[899px]:hidden",
        )}
      >
        <Search
          aria-hidden="true"
          className="size-3.5 flex-none stroke-[1.6]"
        />
        <input
          aria-label="Search"
          className="min-w-0 flex-1 truncate border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) cancel();
          }}
          // An empty field folds away again once focus leaves it, so a
          // shortcut used on a wide screen does not leave a phone bar open.
          onBlur={() => {
            if (!query) setExpanded(false);
          }}
          placeholder="Search names, filings, chats"
          ref={inputRef}
          type="search"
          value={query}
        />
        {shortcutReady ? (
          <kbd className="flex-none font-sans text-foreground-secondary text-xs max-[899px]:hidden">
            ⌘K
          </kbd>
        ) : null}
      </label>
      {open ? (
        <Button
          className="min-[900px]:hidden"
          onClick={cancel}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      ) : (
        <IconButton
          className="min-[900px]:hidden"
          label="Search"
          onClick={() => {
            setExpanded(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          size="sm"
        >
          <Search className="stroke-[1.6]" />
        </IconButton>
      )}
      <div
        className={cn(
          "flex min-w-max items-center justify-end gap-1 min-[900px]:flex-1",
          open && "max-[899px]:hidden",
        )}
      >
        {actions}
      </div>
    </search>
  );
}
