import {
  Button,
  ComboboxList,
  EmptyState,
  Skeleton,
  Toggle,
} from "@pythia/widget-sdk";
import { Fragment, type MouseEvent, useEffect, useRef } from "react";
import {
  type SearchOption,
  TYPE_FILTERS,
  type TypeFilter,
} from "./search-model";
import { SearchRowOption, ToggleOption } from "./search-row";
import { TypePills } from "./type-pills";

export type PanelStatus = "prompt" | "loading" | "error" | "ready";

export type SearchPanelProps = {
  /** Trimmed query the panel describes. */
  query: string;
  status: PanelStatus;
  /** The listed rows answer the current query and filter. */
  fresh: boolean;
  filter: TypeFilter;
  /** Delisted lines are listed, below the live ones. */
  includeDelisted: boolean;
  options: readonly SearchOption[];
  onFilter(value: TypeFilter): void;
  onIncludeDelisted(value: boolean): void;
  onRetry(): void;
  /** A row was chosen by pointer or Enter. */
  onChoose(option: SearchOption): void;
  /** Groups showing all their listings, by group id. */
  expanded?: ReadonlySet<string> | undefined;
  /** An expanded group's read of all its listings, when it is not shown yet
   * ("loading") or failed ("error"); expanded groups not named here show all. */
  pending?: ReadonlyMap<string, "loading" | "error"> | undefined;
  /** A group's toggle was chosen by pointer or Enter. */
  onToggle?: ((groupId: string) => void) | undefined;
};

const keepInputFocus = (event: MouseEvent) => event.preventDefault();

/** Body of the anchored search panel: type pills, one listbox, explicit
 * states and a footer with the key hints. It
 * renders inside a `Combobox`, which owns highlighting and selection;
 * `InvestmentSearch` is the stateful composition. */
export function SearchPanel(props: SearchPanelProps) {
  const { query, status, fresh, filter } = props;
  const body = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query or type starts at the top of its rows.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [query, filter]);
  // Rows exist only while they are shown, so the combobox never highlights or
  // selects a hidden one.
  const shown = status === "ready" ? props.options : [];
  // A group's first listing carries its heading in the same option; the
  // toggle closes the group.
  const renderRow = (
    option: SearchOption,
    index: number,
    list: readonly SearchOption[],
  ) => (
    <Fragment key={option.key}>
      {option.row ? (
        <SearchRowOption
          option={option}
          heading={list[index - 1]?.group.id !== option.group.id}
          onChoose={() => props.onChoose(option)}
        />
      ) : (
        <ToggleOption
          option={option}
          state={
            props.expanded?.has(option.group.id)
              ? (props.pending?.get(option.group.id) ?? "expanded")
              : "collapsed"
          }
          onToggle={() => props.onToggle?.(option.group.id)}
        />
      )}
    </Fragment>
  );
  const companies = new Set(shown.map((option) => option.group.id)).size;
  const filterLabel = TYPE_FILTERS.find((type) => type.value === filter)?.label;
  const announcement =
    status === "loading"
      ? "Searching"
      : status === "ready" && fresh
        ? companies
          ? `${companies} result${companies === 1 ? "" : "s"}`
          : "No matches"
        : "";
  return (
    <div
      data-slot="investment-search-panel"
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex flex-none items-center gap-2 px-3 pt-3 pb-2">
        <TypePills value={filter} onChange={props.onFilter} />
        <Toggle
          label="Include delisted"
          size="sm"
          pressed={props.includeDelisted}
          onPressedChange={props.onIncludeDelisted}
          onMouseDown={keepInputFocus}
          className="ml-auto flex-none rounded-pill data-pressed:border-border-strong"
        />
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
        {status === "ready" && fresh && !shown.length ? (
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
          // One shrinkable column: a long listing detail truncates instead of
          // widening every row past the panel.
          className="grid max-h-none grid-cols-1 overflow-visible"
        >
          {shown.map(renderRow)}
        </ComboboxList>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
      <div
        data-slot="investment-search-footer"
        className="flex min-h-10 flex-none items-center border-border border-t px-3 py-1.5 text-foreground-secondary text-xs"
      >
        <span className="min-w-0 truncate">
          ↑↓ to move · Enter to open · Esc to close
        </span>
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
