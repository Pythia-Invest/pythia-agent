"use client";

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
import {
  demoGroupListings,
  demoSearch,
  searchDemoDirectory,
} from "./search-demo";

const ignore = () => {};
const search = demoSearch(180);
const crypto = TYPE_FILTERS.find((type) => type.value === "crypto")?.kinds;

function options(
  query: string,
  kinds?: typeof crypto,
  expanded?: ReadonlySet<string>,
) {
  return searchOptions(
    searchDemoDirectory(query, { kinds }).groups,
    expanded,
    new Map(
      [...(expanded ?? [])].map((id) => [id, demoGroupListings(id)] as const),
    ),
  );
}

const asml = new Set(["issuer:lei:724500Y6DUVHQD6OXN27"]);

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
            includeDelisted
            onFilter={ignore}
            onIncludeDelisted={ignore}
            onRetry={ignore}
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
  const [chosen, setChosen] = useState<string>();
  return (
    <div className="grid gap-10">
      <p className="max-w-measure text-body text-foreground-secondary">
        Names, tickers, venues and ISINs mirror public reference data so the
        cases are recognisable. Bindings and ranking are synthetic, nothing is
        provider data, and rows carry no prices.
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
              onSelect={setChosen}
              className="max-w-[60%] flex-none"
            />
            <span className="flex-1" />
          </div>
        </QueryClientProvider>
        <p className="text-foreground-secondary text-xs">
          Try asml, asmlf, alphabet, shell, bitcoin, IE00B4L5Y983, milkiland or
          zzzz. Arrow keys move through listings and a company&apos;s “All
          listings” toggle, Enter opens a listing or toggles, Esc closes, Tab
          reaches the type pills and the delisted toggle.
        </p>
        <output className="text-body text-foreground">
          {chosen
            ? `Selected listing ${chosen}; Desk opens its instrument page.`
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
            title="Listings grouped per company"
            note="ASML: its Amsterdam primary listing and the Nasdaq registry shares, then “All 4 listings”. ASM International is another company."
            query="asm"
            options={options("asm")}
          />
          <Specimen
            title="All of a company's listings"
            note="The toggle reveals every line in place and reads “Fewer listings”; arrow keys move through them."
            query="asml"
            options={options("asml", undefined, asml)}
            expanded={asml}
          />
          <Specimen
            title="A typed ticker leads its company"
            note="ASMLF puts the OTC listing first inside the ASML group."
            query="asmlf"
            options={options("asmlf")}
          />
          <Specimen
            title="Share classes"
            note="Alphabet: Class A (GOOGL) and Class C (GOOG) are listings of one company, each with its class."
            query="alphabet"
            options={options("alphabet")}
          />
          <Specimen
            title="Receipts and home lines"
            note="Shell: its Amsterdam line and the NYSE American Depositary Shares; London, Xetra and OTC wait behind the toggle."
            query="shell"
            options={options("shell")}
          />
          <Specimen
            title="Type filter"
            note="Crypto pill: Bitcoin, Ether and Solana with their bound connectors."
            query="crypto"
            filter="crypto"
            options={options("", crypto)}
          />
          <Specimen
            title="A delisted line"
            note="Found by name, ticker or ISIN, marked Delisted and ranked below live lines; the toggle hides it."
            query="milkiland"
            options={options("milkiland")}
          />
          <Specimen
            title="Delisted lines hidden"
            note="With “Include delisted” off, a delisted-only match is no result."
            query="milkiland"
            includeDelisted={false}
          />
          <Specimen
            title="No result"
            note="Search answers from local data only; nothing else is asked."
            query="zzzz"
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
