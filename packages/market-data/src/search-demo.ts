/**
 * Synthetic in-memory directory for tests and the Design Lab until the core
 * directory search exists. The product never imports it.
 *
 * Names, tickers, venues and ISINs mirror public reference data so the cases
 * are recognisable; subject ids follow the identity fixtures. Bindings, dates,
 * ranking and lookup answers are synthetic. There are no prices and no
 * provider data.
 */
import type {
  InstrumentKind,
  LookupRequest,
  SearchGroup,
  SearchRequest,
  SearchResponse,
  SearchRow,
} from "./search";

const asml = "security:isin:NL0010273215";

function row(
  values: Pick<SearchRow, "id" | "ticker"> & Partial<SearchRow>,
): SearchRow {
  return {
    mic: null,
    venue: null,
    currency: null,
    primary: false,
    bindings: [],
    ...values,
  };
}

function coin(
  id: string,
  name: string,
  ticker: string,
  refs: [string, string],
): SearchGroup {
  return {
    id,
    name,
    kind: "coin",
    depositary_of: null,
    rows: [
      row({
        id,
        ticker,
        primary: true,
        bindings: [
          { plugin: "coinmarketcap", ref: refs[0] },
          { plugin: "coingecko", ref: refs[1] },
        ],
      }),
    ],
  };
}

/** Directory order stands in for prominence among equal matches. */
export const demoGroups: readonly SearchGroup[] = [
  {
    id: asml,
    name: "ASML Holding N.V.",
    kind: "ordinary",
    depositary_of: null,
    rows: [
      row({
        id: "listing:isin:NL0010273215:XAMS:EUR",
        ticker: "ASML",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        currency: "EUR",
        primary: true,
        bindings: [
          { plugin: "yahoo", ref: "ASML.AS" },
          { plugin: "eodhd", ref: "ASML.AS" },
        ],
      }),
      row({
        id: "listing:isin:NL0010273215:XETR:EUR",
        ticker: "ASME",
        mic: "XETR",
        venue: "Xetra",
        currency: "EUR",
      }),
      row({
        id: "listing:isin:NL0010273215:PINX:USD",
        ticker: "ASMLF",
        mic: "PINX",
        venue: "OTC Pink",
        currency: "USD",
        bindings: [{ plugin: "yahoo", ref: "ASMLF" }],
      }),
    ],
  },
  {
    id: "security:isin:USN070592100",
    name: "ASML Holding N.V. New York Registry Shares",
    kind: "depositary_receipt",
    depositary_of: { id: asml, name: "ASML Holding N.V." },
    rows: [
      row({
        id: "listing:isin:USN070592100:XNAS:USD",
        ticker: "ASML",
        mic: "XNGS",
        venue: "Nasdaq Global Select",
        currency: "USD",
        primary: true,
        bindings: [
          { plugin: "yahoo", ref: "ASML" },
          { plugin: "eodhd", ref: "ASML.US" },
        ],
      }),
    ],
  },
  {
    id: "security:isin:NL0000334118",
    name: "ASM International N.V.",
    kind: "ordinary",
    depositary_of: null,
    rows: [
      row({
        id: "listing:isin:NL0000334118:XAMS:EUR",
        ticker: "ASM",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        currency: "EUR",
        primary: true,
        bindings: [{ plugin: "yahoo", ref: "ASM.AS" }],
      }),
    ],
  },
  {
    id: "security:isin:IE00B4L5Y983",
    name: "iShares Core MSCI World UCITS ETF",
    kind: "etf",
    depositary_of: null,
    rows: [
      row({
        id: "listing:isin:IE00B4L5Y983:XAMS:EUR",
        ticker: "IWDA",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        currency: "EUR",
        primary: true,
      }),
    ],
  },
  coin(
    "security:caip19:bip122:000000000019d6689c085ae165831e93/slip44:0",
    "Bitcoin",
    "BTC",
    ["1", "bitcoin"],
  ),
  coin("security:caip19:eip155:1/slip44:60", "Ether", "ETH", [
    "1027",
    "ethereum",
  ]),
  coin(
    "security:caip19:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501",
    "Solana",
    "SOL",
    ["5426", "solana"],
  ),
  {
    id: "index:demo:AEX",
    name: "AEX Index",
    kind: "index",
    depositary_of: null,
    rows: [
      row({
        id: "index:demo:AEX",
        ticker: "AEX",
        venue: "Euronext Amsterdam",
        currency: "EUR",
        primary: true,
      }),
    ],
  },
  {
    id: "fx:demo:EURUSD",
    name: "Euro / US Dollar",
    kind: "fx",
    depositary_of: null,
    rows: [row({ id: "fx:demo:EURUSD", ticker: "EUR/USD", primary: true })],
  },
];

export const demoDirectory: SearchResponse["directory"] = {
  snapshot: "demo-reference-2026-09-24",
  as_of: "2026-09-24T06:00:00Z",
};

export const demoLookupOffers: SearchResponse["lookup"] = [
  { plugin: "yahoo", label: "Yahoo Finance" },
];

/** 0 exact ticker or ISIN, 1 ticker prefix, 2 name word prefix, 3 name text. */
function score(group: SearchGroup, query: string) {
  const q = query.toLowerCase();
  const tickers = group.rows.map((line) => line.ticker.toLowerCase());
  const isin = group.id.startsWith("security:isin:")
    ? group.id.slice(14).toLowerCase()
    : undefined;
  const name = group.name.toLowerCase();
  if (tickers.includes(q) || isin === q) return 0;
  if (tickers.some((ticker) => ticker.startsWith(q))) return 1;
  if (name.split(/[\s/.]+/).some((word) => word.startsWith(q))) return 2;
  return name.includes(q) ? 3 : undefined;
}

export function searchDemoDirectory(
  query: string,
  {
    kinds,
    limit = 20,
  }: { kinds?: readonly InstrumentKind[] | undefined; limit?: number } = {},
): SearchResponse {
  const groups = demoGroups
    .map((group, order) => ({ group, order, score: score(group, query) }))
    .filter(
      (entry): entry is typeof entry & { score: number } =>
        entry.score !== undefined &&
        (!kinds || kinds.includes(entry.group.kind)),
    )
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.group);
  return { query, groups, directory: demoDirectory, lookup: demoLookupOffers };
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
    return searchDemoDirectory(request.query, request);
  };
}

/** Yahoo "finds" one synthetic, unverified listing; other plugins find none. */
export function demoLookup(delay = 0) {
  return async ({ plugin, query }: LookupRequest, signal: AbortSignal) => {
    await wait(delay, signal);
    if (plugin !== "yahoo") return [];
    const symbol = query.toUpperCase().slice(0, 12);
    return [
      {
        id: `security:demo:${symbol}`,
        name: `${symbol} (synthetic lookup result)`,
        kind: "ordinary",
        depositary_of: null,
        rows: [
          row({
            id: `listing:demo:${symbol}`,
            ticker: symbol,
            primary: true,
            bindings: [{ plugin: "yahoo", ref: symbol }],
          }),
        ],
      },
    ] satisfies SearchGroup[];
  };
}
