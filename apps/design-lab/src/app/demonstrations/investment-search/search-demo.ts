/**
 * Synthetic in-memory directory for the investment search demonstration.
 *
 * Names, tickers, venues and ISINs mirror public reference data so the cases
 * are recognisable; subject ids follow the identity fixtures. Dates and
 * ranking are synthetic. There are no prices and no provider data.
 */
import type {
  InstrumentKind,
  SearchGroup,
  SearchRequest,
  SearchResponse,
  SearchRow,
} from "@pythia/market-data/search";

import { type Company, demoCompanies } from "./search-demo-companies";

const SHOWN = 3;

/** The relevant listings, as the core orders them: a listing whose ticker
 * the query names, the primary listing, then the first line of each other
 * class or receipt; the rest wait for a group read ("All N listings"). */
function demoGroup(company: Company, query: string): SearchGroup {
  const typed = query.toUpperCase();
  const named = company.rows.filter((row) => row.ticker === typed);
  const firstOfEach = company.rows.filter(
    (row, index) =>
      company.rows.findIndex(
        (other) => other.name === row.name && other.kind === row.kind,
      ) === index,
  );
  const relevant: SearchRow[] = [];
  for (const row of [...named, ...firstOfEach])
    if (relevant.length < SHOWN && !relevant.includes(row)) relevant.push(row);
  return { ...demoAll(company), rows: relevant };
}

/** A group with all its listings: the answer to a group read. */
function demoAll(company: Company): SearchGroup {
  return {
    id: company.id,
    name: company.name,
    kind: company.kind,
    listings: company.rows.length,
    rows: company.rows,
  };
}

/** All listings of one demo group, by its id, as a group read answers. */
export function demoGroupListings(id: string): SearchRow[] {
  return demoCompanies.find((company) => company.id === id)?.rows ?? [];
}

/** 0 exact ticker or ISIN, 1 ticker prefix, 2 name word prefix, 3 name text. */
function score({ name, rows }: Company, query: string) {
  const q = query.toLowerCase();
  const tickers = rows.flatMap((row) =>
    row.ticker ? [row.ticker.toLowerCase()] : [],
  );
  const isins = rows.flatMap((row) =>
    row.id.startsWith("listing:isin:")
      ? [row.id.split(":")[2]?.toLowerCase()]
      : [],
  );
  const lower = name.toLowerCase();
  if (tickers.includes(q) || isins.includes(q)) return 0;
  if (tickers.some((ticker) => ticker.startsWith(q))) return 1;
  if (lower.split(/[\s/.]+/).some((word) => word.startsWith(q))) return 2;
  return lower.includes(q) ? 3 : undefined;
}

export function searchDemoDirectory(
  query: string,
  {
    kinds,
    limit = 20,
    include_delisted = true,
  }: {
    kinds?: readonly InstrumentKind[] | undefined;
    limit?: number;
    include_delisted?: boolean;
  } = {},
): SearchResponse {
  const live = (company: Company) => company.rows.some((row) => !row.delisted);
  const groups = demoCompanies
    .map((company, order) => ({ company, order, score: score(company, query) }))
    .filter(
      (entry): entry is typeof entry & { score: number } =>
        entry.score !== undefined &&
        (include_delisted || live(entry.company)) &&
        (!kinds || entry.company.rows.some((row) => kinds.includes(row.kind))),
    )
    // A company with a live line ranks before one with only delisted lines.
    .sort(
      (a, b) =>
        Number(!live(a.company)) - Number(!live(b.company)) ||
        a.score - b.score ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map((entry) => demoGroup(entry.company, query));
  return { groups };
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

/** An asynchronous directory search; the delay makes loading states visible. */
export function demoSearch(delay = 0) {
  return async (request: SearchRequest, signal: AbortSignal) => {
    await wait(delay, signal);
    const company = demoCompanies.find((entry) => entry.id === request.group);
    if (request.group) return { groups: company ? [demoAll(company)] : [] };
    return searchDemoDirectory(request.query, request);
  };
}
