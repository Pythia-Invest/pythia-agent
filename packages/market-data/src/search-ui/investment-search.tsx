"use client";

import type { InvestmentCategory } from "../search";
import { Button, EmptyState, Popover, Skeleton } from "@pythia/widget-sdk";
import { Search } from "lucide-react";
import type { TopBarContext } from "@pythia/widget-sdk";
import { useEffect, useId, useRef, useState } from "react";
import {
  type AdoptedInvestment,
  useAdoptInvestment,
  useInvestmentSearch,
  useSearchSources,
  searchProviders,
} from "./controller";
import { InvestmentResult } from "./investment-search-result";
import { SearchCategoryFilters, SearchSourceFilters } from "./search-filters";

export type InvestmentSearchProps = Pick<
  TopBarContext,
  "query" | "onQueryChange" | "transport" | "chats" | "openChat" | "prepareChat"
> & { initialExcludedProviders?: readonly string[] };

/** One investment-first search. Chat filtering retains its existing shell state;
 * workspace filename search remains owned by the workspace surface. */
export function InvestmentSearch({
  query,
  onQueryChange,
  transport,
  chats: chatSummaries,
  openChat,
  prepareChat,
  initialExcludedProviders = [],
}: InvestmentSearchProps) {
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState("");
  const [selected, setSelected] = useState<AdoptedInvestment | null>(null);
  const [category, setCategory] = useState<InvestmentCategory | "all">("all");
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const attempt = useRef(0);
  const sources = useSearchSources(transport, open);
  const [excluded, setExcluded] = useState<string[]>(() => [
    ...initialExcludedProviders,
  ]);
  const providers = searchProviders(sources.data, excluded);
  const search = useInvestmentSearch(
    transport,
    settled,
    open && query.trim() === settled,
    providers,
  );
  const selection = useAdoptInvestment(transport, (value) => {
    if (value.revision === attempt.current) setSelected(value);
  });
  useEffect(() => {
    if (popup.current) popup.current.scrollTop = 0;
    const timer = setTimeout(() => setSettled(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        input.current?.select();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const waiting = query.trim() !== settled || search.fetchStatus !== "idle";
  // Retained query data cannot publish while native access is being rechecked.
  const response =
    !waiting && !search.isError && open ? search.data : undefined;
  // Filter the returned matches without re-ranking them or inferring identity
  // from presentation labels. This is deliberately not a provider selector.
  const activeCategory = category;
  const results = response?.data.results.filter(
    (result) => activeCategory === "all" || result.category === activeCategory,
  );
  const chats = chatSummaries
    .filter((chat) =>
      (chat.title ?? "Untitled chat")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .slice(0, 5);
  function research() {
    if (!selected) return;
    const context = `Research ${selected.result.name ?? selected.result.symbol ?? "this investment"}. Pythia subject: ${JSON.stringify(selected.data.subject)}. Data binding: ${JSON.stringify(selected.data.binding)}.`;
    prepareChat(context);
    changeOpen(false);
  }
  function changeOpen(next: boolean) {
    if (!next) {
      attempt.current += 1;
      setSelected(null);
      selection.reset();
    }
    setOpen(next);
  }
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // The editable anchor is not a toggle button. Clicking it must not
        // dismiss/reopen the popup and cancel/restart the current request.
        if (
          !next &&
          details.reason === "outside-press" &&
          details.event.target instanceof Node &&
          anchor.current?.contains(details.event.target)
        ) {
          details.cancel();
          return;
        }
        if (!next && details.reason === "escape-key") input.current?.focus();
        changeOpen(next);
      }}
    >
      <div
        ref={anchor}
        data-slot="investment-search"
        className="flex h-8 w-104 max-w-[60%] items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-body text-foreground-secondary focus-within:outline-2 focus-within:outline-ring"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search investments and chats"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? panelId : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search investments and chats"
          type="search"
          maxLength={512}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              changeOpen(false);
            }
            if (event.key === "ArrowDown" && open) {
              event.preventDefault();
              popup.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus();
            }
          }}
          onChange={(event) => {
            setOpen(true);
            attempt.current += 1;
            onQueryChange(event.target.value);
            setSelected(null);
            selection.reset();
          }}
          className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none"
        />
      </div>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} align="start" sideOffset={4}>
          <Popover.Popup
            ref={popup}
            role="dialog"
            id={panelId}
            initialFocus={false}
            finalFocus={false}
            className={`w-136 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable] motion-reduce:transition-none ${query.trim() ? "h-[min(32rem,var(--available-height))]" : "max-h-(--available-height)"}`}
          >
            <Popover.Title className="sr-only">Search results</Popover.Title>
            <SearchSourceFilters
              providers={sources.data ?? []}
              excluded={excluded}
              progressRows={query.trim() === settled ? search.progress : []}
              coverageRows={response?.data.coverage ?? []}
              waiting={waiting}
              hasQuery={!!query.trim()}
              isError={search.isError}
              onToggle={(provider, included) => {
                attempt.current += 1;
                setSelected(null);
                selection.reset();
                setExcluded((current) =>
                  included
                    ? [...current, provider]
                    : current.filter((value) => value !== provider),
                );
                input.current?.focus();
              }}
            />
            {sources.isError ? (
              <p role="alert" className="text-xs">
                Connectors could not be loaded.{" "}
                <button type="button" onClick={() => void sources.refetch()}>
                  Retry
                </button>
              </p>
            ) : null}
            {providers?.length === 0 ? (
              <p className="mb-2 text-foreground-secondary text-xs">
                All connectors are excluded.
              </p>
            ) : null}
            <SearchCategoryFilters
              activeCategory={activeCategory}
              onChange={(value) => {
                setCategory(value);
                input.current?.focus();
              }}
            />
            {selected ? (
              <section
                aria-label="Selected investment"
                className="mt-4 rounded-control border border-border p-3"
              >
                <h3 className="font-semibold">
                  {selected.result.name ??
                    selected.result.symbol ??
                    "Selected investment"}
                </h3>
                <p className="text-foreground-secondary text-xs">
                  {[
                    selected.result.symbol,
                    selected.result.venue,
                    selected.result.currency,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="my-2 text-body">Investment saved.</p>
                {selected.issues.map((issue) => (
                  <p key={`${issue.code}-${issue.message}`}>{issue.message}</p>
                ))}
                <Button onClick={research}>Continue research in chat</Button>
              </section>
            ) : null}
            {selection.isError ? (
              <p role="alert" className="mt-3 text-body text-error">
                {selection.error.message}
              </p>
            ) : null}
            {query.trim() ? (
              <section aria-label="Investments">
                <div role="status" className="sr-only">
                  {waiting || search.isPending
                    ? "Searching investments…"
                    : null}
                </div>
                {waiting || search.isPending ? (
                  <div aria-hidden="true" className="space-y-1">
                    {[0, 1, 2, 3, 4, 5].map((row) => (
                      <div
                        key={row}
                        className="flex h-14 items-center justify-between px-2"
                      >
                        <div className="space-y-2">
                          <Skeleton className="h-3 w-14" />
                          <Skeleton className="h-3 w-36" />
                        </div>
                        <Skeleton className="h-3 w-16" />
                      </div>
                    ))}
                  </div>
                ) : null}
                {search.isError && !waiting ? (
                  <div role="alert">
                    <p>
                      Investment search is unavailable. Your chats are still
                      searchable.
                    </p>
                    <Button onClick={() => void search.refetch()}>
                      Retry search
                    </Button>
                  </div>
                ) : null}
                {response?.outcome === "error" ? (
                  <p role="alert">Investment search could not be completed.</p>
                ) : null}
                {response &&
                results?.length === 0 &&
                response.outcome !== "error" ? (
                  <p className="text-body text-foreground-secondary">
                    No matches in this category. Try another filter or search.
                  </p>
                ) : null}
                <ul>
                  {results?.map((result) => (
                    <InvestmentResult
                      key={result.id}
                      result={result}
                      pending={selection.isPending}
                      onSelect={() =>
                        selection.mutate({
                          result,
                          revision: ++attempt.current,
                        })
                      }
                    />
                  ))}
                </ul>
                {selection.isPending ? (
                  <p role="status">Saving investment reference…</p>
                ) : null}
                {response?.data.truncated ? (
                  <p className="mt-2 text-foreground-secondary text-xs">
                    Filters apply to these matches. Refine your search for more.
                  </p>
                ) : null}
                {response &&
                (response.issues.length > 0 ||
                  response.data.coverage.some(
                    (source) => source.issues.length > 0,
                  )) ? (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">
                      Search coverage
                    </summary>
                    {response.issues.map((issue) => (
                      <p key={`${issue.code}-${issue.message}`}>
                        {issue.message}
                      </p>
                    ))}
                    {response.data.coverage.map((source) => (
                      <p key={source.provider}>
                        {source.provider}: {source.status}
                        {source.issues
                          .map((issue) => ` · ${issue.message}`)
                          .join("")}
                      </p>
                    ))}
                  </details>
                ) : null}
              </section>
            ) : (
              <EmptyState
                title="Find an investment"
                description="Enter a name, ticker or identifier to search your sources and saved investments."
                className="border-0 bg-transparent py-6"
              />
            )}
            {query.trim() && chats.length > 0 ? (
              <section
                aria-label="Chats"
                className="mt-3 border-border border-t pt-3"
              >
                <h3 className="font-semibold text-body">Chats</h3>
                {chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    onClick={() => {
                      changeOpen(false);
                      openChat(chat.id);
                    }}
                    className="block w-full rounded-control px-2 py-2 text-left text-body hover:bg-raised focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {chat.title ?? "Untitled chat"}
                  </button>
                ))}
              </section>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
