"use client";

import {
  Combobox,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  cn,
} from "@pythia/widget-sdk";
import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LookupOffer, SearchGroup } from "../search";
import {
  type LookupRunner,
  type SearchBackend,
  useDirectorySearch,
} from "./controller";
import {
  type SearchOption,
  searchOptions,
  type TypeFilter,
} from "./search-model";
import {
  type LookupState,
  type PanelStatus,
  SearchPanel,
} from "./search-panel";

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

const NO_GROUPS: SearchGroup[] = [];
const NO_OFFERS: LookupOffer[] = [];

/** Busy cues appear only when work is noticeably slow, so fast local reads
 * never flash a spinner. */
function useDelayedFlag(flag: boolean, delay: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    if (!flag) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [flag, delay]);
  return flag && shown;
}

/** One field for names, tickers and identifiers with a panel anchored to it.
 * Base UI's combobox owns focus, highlighting, selection and dismissal; this
 * component owns the directory read, the type filter and the explicit lookup.
 * Nothing here calls a connector unless the user presses a lookup action. */
export function InvestmentSearch({
  query,
  onQueryChange,
  search,
  lookup,
  onSelect,
  shortcut = true,
  className,
}: InvestmentSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<SearchOption | undefined>(undefined);
  const lookupAbort = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<TypeFilter>("all");
  const [lookupState, setLookupState] = useState<LookupState>();

  const trimmed = query.trim();
  // Every keystroke is its own local read; React Query cancels the superseded
  // one and keeps the previous rows on screen until the new ones arrive.
  const result = useDirectorySearch(search, trimmed, filter, open);
  const response = trimmed ? result.data : undefined;
  const fresh = Boolean(response) && !result.isPlaceholderData;
  const shownLookup = lookupState?.query === trimmed ? lookupState : undefined;
  const found = shownLookup?.status === "done" ? shownLookup.groups : NO_GROUPS;
  const options = useMemo(
    () => [
      ...searchOptions(response?.groups ?? NO_GROUPS, "directory"),
      ...searchOptions(found, "lookup"),
    ],
    [response, found],
  );
  const status: PanelStatus = !trimmed
    ? "prompt"
    : result.isError && !result.isFetching
      ? "error"
      : response
        ? "ready"
        : "loading";
  const busy = useDelayedFlag(
    open && Boolean(trimmed) && result.isFetching,
    250,
  );

  useEffect(() => () => lookupAbort.current?.abort(), []);

  useEffect(() => {
    if (!shortcut) return;
    const onShortcut = (event: KeyboardEvent) => {
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

  async function runLookup(offer: LookupOffer) {
    if (!lookup || !trimmed || lookupState?.status === "running") return;
    const controller = new AbortController();
    lookupAbort.current = controller;
    const base = { plugin: offer.plugin, label: offer.label, query: trimmed };
    setLookupState({ ...base, status: "running", groups: [] });
    try {
      const groups = await lookup(
        { plugin: offer.plugin, query: trimmed },
        controller.signal,
      );
      if (!controller.signal.aborted)
        setLookupState({ ...base, status: "done", groups });
    } catch {
      if (!controller.signal.aborted)
        setLookupState({ ...base, status: "error", groups: [] });
    }
  }

  return (
    <Combobox<SearchOption>
      // Rows are destinations, not a remembered value: a choice reports its
      // subject id and leaves the typed query as it was.
      value={null}
      onValueChange={(option) => {
        if (option) onSelect(option.row.id);
      }}
      inputValue={query}
      onInputValueChange={(value, details) => {
        // Base UI also writes the chosen row's label, and clears the field when
        // the panel closes; only typing and Escape change the query.
        if (
          details.reason !== "input-change" &&
          details.reason !== "escape-key"
        )
          return;
        if (value.trim() !== trimmed) {
          lookupAbort.current?.abort();
          setLookupState(undefined);
        }
        onQueryChange(value);
      }}
      open={open}
      onOpenChange={setOpen}
      onItemHighlighted={(option) => {
        highlighted.current = option;
      }}
      itemToStringLabel={(option) => option.row.ticker}
      filter={null}
      autoHighlight
    >
      <ComboboxInputGroup
        data-slot="investment-search"
        className={cn(
          "h-8 min-h-8 w-104 min-w-0 max-w-full cursor-text gap-2 px-2.5 text-foreground-secondary hover:bg-raised",
          className,
        )}
      >
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 flex-none animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Search aria-hidden="true" className="size-3.5 flex-none" />
        )}
        <ComboboxInput
          ref={input}
          aria-label="Search investments"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search by name, ticker or ISIN"
          type="search"
          maxLength={512}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !open || !trimmed) return;
            // Enter opens a row of the typed query only: rows of the previous
            // query, still shown while it loads, are not a choice.
            const first = options[0];
            if (!fresh || !highlighted.current) {
              event.preventDefault();
              event.preventBaseUIHandler();
              if (fresh && first) {
                onSelect(first.row.id);
                setOpen(false);
              }
            }
          }}
          className="min-h-0 px-0 text-body"
        />
        {shortcut ? (
          <kbd className="hidden flex-none font-sans text-foreground-secondary text-xs min-[600px]:block">
            ⌘K
          </kbd>
        ) : null}
      </ComboboxInputGroup>
      <ComboboxPortal>
        {/* Always below the bar: the panel shifts sideways and shortens to
            fit rather than jumping to another side. */}
        <ComboboxPositioner
          side="bottom"
          align="start"
          collisionPadding={8}
          collisionAvoidance={{
            side: "none",
            align: "shift",
            fallbackAxisSide: "none",
          }}
        >
          <ComboboxPopup
            aria-label="Investment search"
            className="motion-fast h-[min(28rem,var(--available-height))] w-136 max-w-[calc(100vw-1rem)] origin-(--transform-origin) p-0 shadow-overlay transition-[opacity,transform] data-ending-style:scale-[0.97] data-starting-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            <SearchPanel
              query={trimmed}
              status={status}
              fresh={fresh}
              directory={response?.directory}
              filter={filter}
              options={options}
              offers={
                lookup && trimmed ? (response?.lookup ?? NO_OFFERS) : NO_OFFERS
              }
              lookup={shownLookup}
              onFilter={setFilter}
              onRetry={() => void result.refetch()}
              onLookup={(offer) => void runLookup(offer)}
            />
          </ComboboxPopup>
        </ComboboxPositioner>
      </ComboboxPortal>
    </Combobox>
  );
}
