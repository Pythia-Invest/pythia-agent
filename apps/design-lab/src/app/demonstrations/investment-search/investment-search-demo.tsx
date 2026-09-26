"use client";

import {
  demoDirectory,
  demoLookup,
  demoLookupOffers,
  demoSearch,
  searchDemoDirectory,
} from "@pythia/market-data/search-demo";
import {
  InvestmentSearch,
  SearchPanel,
  type SearchPanelProps,
  searchOptions,
  TYPE_FILTERS,
} from "@pythia/market-data/search-ui";
import { Combobox } from "@pythia/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

const ignore = () => {};
const search = demoSearch(180);
const lookup = demoLookup(900);
const crypto = TYPE_FILTERS.find((type) => type.value === "crypto")?.kinds;

function options(query: string, kinds?: typeof crypto) {
  return searchOptions(
    searchDemoDirectory(query, { kinds }).groups,
    "directory",
  );
}

/** A synthetic lookup answer: groups of the search shape with subject ids. */
const found = searchOptions(
  [
    {
      id: "security:demo:ASML.MI",
      name: "ASML.MI (synthetic lookup result)",
      kind: "ordinary",
      depositary_of: null,
      rows: [
        {
          id: "listing:demo:ASML.MI",
          ticker: "ASML.MI",
          mic: null,
          venue: null,
          currency: null,
          primary: true,
          bindings: [{ plugin: "yahoo", ref: "ASML.MI" }],
        },
      ],
    },
  ],
  "lookup",
);

function Specimen({
  title,
  note,
  ...props
}: Partial<SearchPanelProps> & { title: string; note: string }) {
  const list = props.options ?? [];
  return (
    <figure className="grid min-w-0 gap-2">
      <figcaption className="grid gap-0.5">
        <span className="font-semibold text-body text-foreground">{title}</span>
        <span className="text-foreground-secondary text-xs">{note}</span>
      </figcaption>
      <div className="h-112 w-full min-w-0 max-w-136 overflow-hidden rounded-container border border-border bg-overlay text-foreground shadow-overlay">
        {/* An inline combobox supplies the list context without a field. */}
        <Combobox inline value={null} filter={null}>
          <SearchPanel
            query=""
            status="ready"
            fresh
            directory={demoDirectory}
            filter="all"
            offers={props.query ? demoLookupOffers : []}
            onFilter={ignore}
            onRetry={ignore}
            onLookup={ignore}
            {...props}
            options={list}
          />
        </Combobox>
      </div>
    </figure>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="font-semibold text-foreground text-reading">{title}</h3>
      {children}
    </section>
  );
}

export function InvestmentSearchDemo() {
  const [client] = useState(() => new QueryClient());
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string>();
  return (
    <div className="grid gap-10">
      <p className="max-w-measure text-body text-foreground-secondary">
        Names, tickers, venues and ISINs mirror public reference data so the
        cases are recognisable. Bindings, dates, ranking and lookup results are
        synthetic, nothing is provider data, and rows carry no prices.
      </p>
      <Section title="Anchored search">
        <QueryClientProvider client={client}>
          <div className="flex h-12 items-center gap-4 rounded-container border border-border bg-canvas px-4">
            <span className="min-w-0 flex-1 truncate font-semibold text-body text-foreground">
              Synthetic workspace
            </span>
            <InvestmentSearch
              query={query}
              onQueryChange={setQuery}
              search={search}
              lookup={lookup}
              onSelect={setChosen}
              className="max-w-[60%] flex-none"
            />
            <span className="flex-1" />
          </div>
        </QueryClientProvider>
        <p className="text-foreground-secondary text-xs">
          Try asml, asm, bitcoin, sol, IE00B4L5Y983 or zzzz. Arrow keys move,
          Enter opens, Esc closes, Tab reaches the type pills and the lookup
          action.
        </p>
        <output className="text-body text-foreground">
          {chosen
            ? `Selected subject ${chosen}. The instrument page opens it once its route exists.`
            : "No row selected yet."}
        </output>
      </Section>
      <Section title="Panel states">
        {/* Specimens keep the panel's real width wherever it fits. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,34rem),1fr))] gap-8">
          <Specimen
            title="Empty query"
            note="Clean prompt; nothing is searched yet."
            status="prompt"
          />
          <Specimen
            title="First load"
            note="Reserved row geometry while the directory answers."
            query="asml"
            status="loading"
            directory={undefined}
          />
          <Specimen
            title="Listings of one security"
            note="Amsterdam primary first, then Xetra and the OTC line; the New York Registry Shares are a depositary receipt of the same issuer."
            query="asml"
            options={options("asml")}
          />
          <Specimen
            title="Type filter"
            note="Crypto pill: Bitcoin, Ether and Solana with their bound connectors."
            query="crypto"
            filter="crypto"
            options={options("", crypto)}
          />
          <Specimen
            title="No result"
            note="The only way past the directory is an explicit lookup."
            query="zzzz"
          />
          <Specimen
            title="Lookup result"
            note="One provider per action; its rows are listed apart."
            query="asml.mi"
            options={found}
            lookup={{
              plugin: "yahoo",
              label: "Yahoo Finance",
              query: "asml.mi",
              status: "done",
              groups: found.map((option) => option.group),
            }}
          />
          <Specimen
            title="Lookup in progress"
            note="The action waits; typing stays local."
            query="adyen"
            lookup={{
              plugin: "yahoo",
              label: "Yahoo Finance",
              query: "adyen",
              status: "running",
              groups: [],
            }}
          />
          <Specimen
            title="Search unavailable"
            note="A failed directory read is an error, not an empty result."
            query="asml"
            status="error"
            directory={undefined}
          />
        </div>
      </Section>
    </div>
  );
}
