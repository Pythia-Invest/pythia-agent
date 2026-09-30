"use client";

import { Alert, Button, Input } from "@pythia/ui";
import Link from "next/link";
import { useState } from "react";
import {
  type DataSource,
  type LookupSummary,
  placedLine,
  useLookupSource,
} from "@/client/data-sources";
import { instrumentHref } from "@/components/instrument/instrument-href";

const SHOWN = 5;
const SCHEMES: Record<string, string> = {
  isin: "ISIN",
  lei: "LEI",
  cik: "CIK",
  figi: "FIGI",
  share_class_figi: "FIGI",
  composite_figi: "FIGI",
};

/** The identifiers a plugin's resolve takes, as the investor names them. */
export function lookupKinds(schemes: readonly string[]) {
  const names = [
    ...new Set(schemes.map((scheme) => SCHEMES[scheme] ?? scheme)),
  ];
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`
    : (names[0] ?? "identifier");
}

/** Whether the plugin answered anything core kept; "no match" is all zeros. */
function stored({ rejected, ...counts }: LookupSummary) {
  return (
    rejected +
      counts.joined +
      counts.introduced +
      counts.conflicts +
      counts.unmatched >
    0
  );
}

/** A plugin's own lookup, on its row in Settings → Data → Data sources: one
 * identifier in, what the plugin answered out, and how each record was placed
 * (joined to a subject Pythia had, introduced as a new one, kept as a conflict
 * or left unmatched). It calls that plugin once and never runs from search. */
export function SourceLookup({ source }: { source: DataSource }) {
  const lookup = useLookupSource();
  const [query, setQuery] = useState("");
  const kinds = lookupKinds(source.lookup);
  const answer = lookup.data;
  const placed = answer?.summary.subjects ?? [];
  return (
    <div data-slot="source-lookup" className="mt-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim())
            lookup.mutate({ plugin: source.plugin, query: query.trim() });
        }}
      >
        <Input
          size="sm"
          aria-label={`Look up ${kinds} in ${source.label}`}
          placeholder={`Look up ${kinds}`}
          maxLength={128}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-56 font-mono"
        />
        <Button
          size="sm"
          variant="secondary"
          type="submit"
          loading={lookup.isPending}
          disabled={!query.trim()}
        >
          Look up
        </Button>
      </form>
      {answer ? (
        <p
          role="status"
          className="m-0 mt-2 text-body text-foreground-secondary leading-ui"
        >
          {stored(answer.summary)
            ? `Stored: ${placedLine(answer.summary)}.`
            : (answer.issue ?? "Nothing was stored.")}
          {placed.length ? " Placed on " : ""}
          {placed.slice(0, SHOWN).map((id, index) => (
            <span key={id}>
              {index ? ", " : ""}
              <Link href={instrumentHref(id)} className="underline">
                {id}
              </Link>
            </span>
          ))}
          {placed.length > SHOWN ? `, and ${placed.length - SHOWN} more` : ""}
          {placed.length ? "." : ""}
        </p>
      ) : null}
      {lookup.error ? (
        <Alert className="mt-2" tone="error" title={lookup.error.message} />
      ) : null}
    </div>
  );
}
