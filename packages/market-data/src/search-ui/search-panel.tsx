import { Button, ComboboxList, EmptyState, Skeleton } from "@pythia/widget-sdk";
import { LoaderCircle } from "lucide-react";
import { type MouseEvent, useEffect, useRef } from "react";
import type { LookupOffer, SearchRow } from "../search";
import {
  type SearchOption,
  TYPE_FILTERS,
  type TypeFilter,
} from "./search-model";
import { ConnectorMark, SearchRowOption } from "./search-row";
import { TypePills } from "./type-pills";

export type PanelStatus = "prompt" | "loading" | "error" | "ready";

export type LookupState = {
  plugin: string;
  label: string;
  query: string;
  status: "running" | "done" | "error";
  rows: SearchRow[];
};

export type SearchPanelProps = {
  /** Trimmed query the panel describes. */
  query: string;
  status: PanelStatus;
  /** The listed rows answer the current query and filter. */
  fresh: boolean;
  filter: TypeFilter;
  options: readonly SearchOption[];
  /** Plugins the user may explicitly look the query up in. */
  offers: readonly LookupOffer[];
  lookup?: LookupState | undefined;
  onFilter(value: TypeFilter): void;
  onRetry(): void;
  onLookup(offer: LookupOffer): void;
  /** A row was chosen by pointer or Enter. */
  onChoose(option: SearchOption): void;
};

const keepInputFocus = (event: MouseEvent) => event.preventDefault();

/** Body of the anchored search panel: type pills, one listbox, explicit
 * states and a footer with the key hints and the lookup actions. It
 * renders inside a `Combobox`, which owns highlighting and selection;
 * `InvestmentSearch` is the stateful composition. */
export function SearchPanel(props: SearchPanelProps) {
  const { query, status, fresh, filter, lookup } = props;
  const body = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query or type starts at the top of its rows.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [query, filter]);
  // Rows exist only while they are shown, so the combobox never highlights or
  // selects a hidden one.
  const shown = status === "ready" ? props.options : [];
  const directory = shown.filter((option) => option.source === "directory");
  const found = shown.filter((option) => option.source === "lookup");
  const renderRow = (option: SearchOption) => (
    <SearchRowOption
      key={option.key}
      option={option}
      onChoose={() => props.onChoose(option)}
    />
  );
  const filterLabel = TYPE_FILTERS.find((type) => type.value === filter)?.label;
  const announcement =
    status === "loading"
      ? "Searching"
      : status === "ready" && fresh
        ? directory.length
          ? `${directory.length} result${directory.length === 1 ? "" : "s"}`
          : "No matches"
        : "";
  return (
    <div
      data-slot="investment-search-panel"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex-none px-3 pt-3 pb-2">
        <TypePills value={filter} onChange={props.onFilter} />
      </div>
      <div
        ref={body}
        data-slot="investment-search-body"
        className="@container min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-1.5 pb-1.5 [scrollbar-gutter:stable]"
      >
        {status === "prompt" ? (
          <EmptyState
            title="Search investments"
            description="Stocks, ETFs, crypto and more, by name, ticker or ISIN."
            className="border-0 bg-transparent py-10"
          />
        ) : null}
        {status === "loading" ? <SkeletonRows /> : null}
        {status === "error" ? (
          <div
            role="alert"
            data-slot="investment-search-error"
            className="grid justify-items-center gap-3 px-4 py-10 text-center"
          >
            <p className="text-body text-foreground">
              Investment search is unavailable right now.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onMouseDown={keepInputFocus}
              onClick={props.onRetry}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {status === "ready" && fresh && !directory.length ? (
          <div
            data-slot="investment-search-no-results"
            className="grid justify-items-center gap-1 px-4 py-8 text-center"
          >
            <p className="font-semibold text-body text-foreground">
              Nothing matches “{query}”
              {filter === "all" ? "" : ` in ${filterLabel}`}
            </p>
            <p className="text-foreground-secondary text-xs">
              {filter !== "all"
                ? "Other types may still match."
                : props.offers.length
                  ? "Check the spelling, or look it up below."
                  : "Check the spelling, or try a ticker or ISIN."}
            </p>
            {filter !== "all" ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onMouseDown={keepInputFocus}
                onClick={() => props.onFilter("all")}
              >
                Show all types
              </Button>
            ) : null}
          </div>
        ) : null}
        <ComboboxList
          aria-label="Investments"
          aria-busy={status === "ready" && !fresh}
          hidden={!shown.length}
          className="grid max-h-none overflow-visible"
        >
          {directory.map(renderRow)}
          {found.length && lookup ? (
            <div
              aria-hidden="true"
              className="flex items-center gap-1.5 px-2.5 pt-2 text-foreground-secondary text-xs"
            >
              <ConnectorMark plugin={lookup.plugin} />
              From {lookup.label}
            </div>
          ) : null}
          {found.map(renderRow)}
        </ComboboxList>
        {lookup?.status === "running" ? (
          <p className="flex items-center gap-2 px-2.5 py-3 text-foreground-secondary text-xs">
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Looking up “{lookup.query}” in {lookup.label}…
          </p>
        ) : null}
        {lookup?.status === "done" && !found.length ? (
          <p className="px-2.5 py-3 text-foreground-secondary text-xs">
            {lookup.label} has no match for “{lookup.query}”.
          </p>
        ) : null}
        {lookup?.status === "error" ? (
          <p role="alert" className="px-2.5 py-3 text-error text-xs">
            The {lookup.label} lookup failed. You can try again.
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
      <div
        data-slot="investment-search-footer"
        className="@container flex min-h-10 flex-none items-center justify-end gap-2 border-border border-t px-3 py-1.5 text-foreground-secondary text-xs"
      >
        {/* Key hints yield to the lookup actions in a narrow panel. */}
        <span className="@md:block hidden min-w-0 flex-1 truncate">
          ↑↓ to move · Enter to open · Esc to close
        </span>
        {props.offers.map((offer) => {
          const running =
            lookup?.status === "running" && lookup.plugin === offer.plugin;
          return (
            <button
              key={offer.plugin}
              type="button"
              data-slot="investment-search-lookup"
              aria-label={`Look up “${query}” in ${offer.label}`}
              aria-busy={running}
              disabled={lookup?.status === "running"}
              onMouseDown={keepInputFocus}
              onClick={() => props.onLookup(offer)}
              className="motion-fast inline-flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-control px-2 font-semibold text-foreground text-xs transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-disabled motion-reduce:transition-none"
            >
              {running ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3 flex-none animate-spin motion-reduce:animate-none"
                />
              ) : (
                <ConnectorMark plugin={offer.plugin} />
              )}
              <span className="truncate">Look up in {offer.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div aria-hidden="true" className="grid">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className="flex h-9 items-center gap-3 px-2.5">
          <Skeleton className="h-3 w-14 flex-none" />
          <Skeleton className="h-3 w-40" />
          <span className="flex-1" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  );
}
