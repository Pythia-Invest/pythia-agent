"use client";

import {
  InvestmentSearch,
  listingOptions,
  type SearchChoice,
  SearchPanel,
  type SearchPanelProps,
  searchOptions,
  TYPE_FILTERS,
} from "@pythia/market-data/search-ui";
import { Combobox } from "@pythia/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  demoListingChoices,
  demoListings,
  demoLookup,
  demoLookupOffers,
  demoLookupRow,
  demoSearch,
  searchDemoDirectory,
} from "./search-demo";

const ignore = () => {};
const search = demoSearch(180);
const lookup = demoLookup(900);
const listings = demoListings(300);
const crypto = TYPE_FILTERS.find((type) => type.value === "crypto")?.kinds;

function options(query: string, kinds?: typeof crypto) {
  return searchOptions(searchDemoDirectory(query, { kinds }).rows, "directory");
}

/** A synthetic lookup answer: rows of the search shape with subject ids. */
const found = searchOptions([demoLookupRow("ASML.MI")], "lookup");

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
            filter="all"
            offers={props.query ? demoLookupOffers : []}
            onFilter={ignore}
            onRetry={ignore}
            onLookup={ignore}
            onChoose={ignore}
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
  const [chosen, setChosen] = useState<SearchChoice>();
  return (
    <div className="grid gap-10">
      <p className="max-w-measure text-body text-foreground-secondary">
        Names, tickers, venues and ISINs mirror public reference data so the
        cases are recognisable. Bindings, ranking and lookup results are
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
              listings={listings}
              className="max-w-[60%] flex-none"
            />
            <span className="flex-1" />
          </div>
        </QueryClientProvider>
        <p className="text-foreground-secondary text-xs">
          Try asml, asmlf, alphabet, bitcoin, IE00B4L5Y983 or zzzz. Arrow keys
          move, Enter opens the row&apos;s listing, → or “+N” shows the
          instrument&apos;s listings (← back), Esc closes, Tab reaches the type
          pills and the lookup action.
        </p>
        <output className="text-body text-foreground">
          {chosen
            ? `Opens instrument ${chosen.subject} on listing ${chosen.listing}.`
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
          />
          <Specimen
            title="One row per instrument"
            note="ASML shows its Amsterdam primary listing; the Nasdaq registry shares, Xetra and OTC lines are its other listings. ASM International is another company."
            query="asm"
            options={options("asm")}
          />
          <Specimen
            title="An instrument's listings"
            note="→ or “+3” on the ASML row: every line of the company, receipts included; Enter opens that listing, ← goes back."
            query="asml"
            side={(() => {
              const row = searchDemoDirectory("asml").rows[0];
              return row
                ? {
                    row,
                    status: "ready" as const,
                    options: listingOptions(row, demoListingChoices(row.id)),
                  }
                : undefined;
            })()}
            options={options("asml")}
          />
          <Specimen
            title="A typed ticker names its listing"
            note="ASMLF opens the OTC listing of the same company row."
            query="asmlf"
            options={options("asmlf")}
          />
          <Specimen
            title="Share classes"
            note="GOOGL and GOOG are different instruments of one issuer, so each has its own row."
            query="alphabet"
            options={options("alphabet")}
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
              rows: found.map((option) => option.row),
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
              rows: [],
            }}
          />
          <Specimen
            title="Search unavailable"
            note="A failed directory read is an error, not an empty result."
            query="asml"
            status="error"
          />
        </div>
      </Section>
    </div>
  );
}
