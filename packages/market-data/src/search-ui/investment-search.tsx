"use client";

import { cn, Popover } from "@pythia/widget-sdk";
import { LoaderCircle, Search } from "lucide-react";
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { LookupRunner, SearchBackend } from "./controller";
import { listboxId, optionId, SearchPanel } from "./search-panel";
import { type SessionKey, useSearchSession } from "./search-session";

export type InvestmentSearchProps = {
  query: string;
  onQueryChange(query: string): void;
  /** Local directory read; never a connector call. */
  search: SearchBackend;
  /** Runs the explicit single-plugin lookup the directory offers at the
   * bottom of the panel. Without it, no lookup action is shown. */
  lookup?: LookupRunner | undefined;
  /** The chosen row's subject id, which an instrument page addresses. */
  onSelect(subjectId: string): void;
  /** Register the Cmd/Ctrl+K shortcut. Disable when several instances mount. */
  shortcut?: boolean | undefined;
  className?: string | undefined;
};

const SESSION_KEYS = new Set<string>(["ArrowDown", "ArrowUp", "Enter"]);
const TABBABLE = 'button:not(:disabled):not([tabindex="-1"])';

/** One field for names, tickers and identifiers with a panel anchored to it.
 * Results come from the local directory; focus stays in the field while the
 * arrow keys move the highlighted row. Nothing here calls a connector unless
 * the user presses an explicit lookup action. */
export function InvestmentSearch({
  query,
  onQueryChange,
  search,
  lookup,
  onSelect,
  shortcut = true,
  className,
}: InvestmentSearchProps) {
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const session = useSearchSession({
    baseId,
    query,
    open,
    search,
    lookup,
    select(subjectId) {
      onSelect(subjectId);
      setOpen(false);
    },
  });

  useEffect(() => {
    if (!shortcut) return;
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLowerCase() !== "k"
      )
        return;
      event.preventDefault();
      setOpen(true);
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [shortcut]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (open) setOpen(false);
      else if (query) onQueryChange("");
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && open) {
      const first = document
        .getElementById(panelId)
        ?.querySelector<HTMLElement>(TABBABLE);
      if (first) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (!SESSION_KEYS.has(event.key)) return;
    if (!open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (session.key(event.key as SessionKey)) event.preventDefault();
  }

  function onBlur(event: FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      document.getElementById(panelId)?.contains(next)
    )
      return;
    setOpen(false);
  }

  // Tab cycles between the field and the panel's controls instead of
  // escaping into the page behind the portal.
  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const tabbable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE),
    ];
    const edge = event.shiftKey ? tabbable[0] : tabbable.at(-1);
    if (event.target !== edge) return;
    event.preventDefault();
    input.current?.focus();
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        const target =
          details.event instanceof FocusEvent
            ? details.event.relatedTarget
            : details.event?.target;
        // The editable anchor is not a toggle: pressing or refocusing it must
        // not dismiss the panel.
        if (
          !next &&
          target instanceof Node &&
          anchor.current?.contains(target)
        ) {
          details.cancel();
          return;
        }
        if (!next && details.reason === "escape-key") input.current?.focus();
        setOpen(next);
      }}
    >
      <div
        ref={anchor}
        data-slot="investment-search"
        className={cn(
          "motion-fast flex h-8 w-104 min-w-0 max-w-full cursor-text items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-foreground-secondary transition-colors focus-within:border-border-strong focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 hover:border-border-strong motion-reduce:transition-none",
          className,
        )}
      >
        {session.busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 flex-none animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Search aria-hidden="true" className="size-3.5 flex-none" />
        )}
        <input
          ref={input}
          role="combobox"
          aria-label="Search investments"
          aria-expanded={open}
          aria-controls={listboxId(baseId)}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            open && session.status === "ready" && session.activeIndex >= 0
              ? optionId(baseId, session.activeIndex)
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by name, ticker or ISIN"
          type="search"
          maxLength={512}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={onBlur}
          onChange={(event) => {
            session.edit(event.target.value);
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 border-0 bg-transparent text-body text-foreground outline-none placeholder:text-foreground-secondary"
        />
        {shortcut ? (
          <kbd className="hidden flex-none font-sans text-foreground-secondary text-xs min-[600px]:block">
            ⌘K
          </kbd>
        ) : null}
      </div>
      <Popover.Portal>
        {/* Always below the bar: the panel shifts sideways and shortens to
            fit rather than jumping to another side. */}
        <Popover.Positioner
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          collisionAvoidance={{
            side: "none",
            align: "shift",
            fallbackAxisSide: "none",
          }}
        >
          <Popover.Popup
            id={panelId}
            aria-label="Investment search"
            initialFocus={false}
            finalFocus={false}
            onKeyDown={onPanelKeyDown}
            className="h-[min(28rem,var(--available-height))] w-136 min-w-(--anchor-width) max-w-[calc(100vw-1rem)] overflow-hidden p-0"
          >
            <SearchPanel
              baseId={baseId}
              query={session.trimmed}
              status={session.status}
              fresh={session.fresh}
              directory={session.response?.directory}
              filter={session.filter}
              options={session.options}
              activeKey={session.active?.key}
              offers={session.offers}
              lookup={session.lookup}
              onFilter={session.changeFilter}
              onPoint={session.point}
              onChoose={session.choose}
              onRetry={session.retry}
              onLookup={session.runLookup}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
