/**
 * Synthetic in-memory directory for the investment search demonstration.
 *
 * Names, tickers, venues and ISINs mirror public reference data so the cases
 * are recognisable; subject ids follow the identity fixtures. Bindings, dates,
 * ranking and lookup answers are synthetic. There are no prices and no
 * provider data.
 */
import type {
  InstrumentKind,
  LookupRequest,
  SearchRequest,
  SearchResponse,
  SearchRow,
} from "@pythia/market-data/search";

type Listing = Pick<SearchRow, "id" | "ticker"> &
  Partial<Pick<SearchRow, "mic" | "venue" | "country" | "bindings">>;

/** One instrument and its listings, primary listing first. */
type Instrument = {
  security: string;
  name: string;
  kind: InstrumentKind;
  listings: Listing[];
};

const yahoo = (ref: string) => ({ plugin: "yahoo", ref });
const eodhd = (ref: string) => ({ plugin: "eodhd", ref });

function coin(
  security: string,
  name: string,
  ticker: string,
  refs: [string, string],
): Instrument {
  return {
    security,
    name,
    kind: "coin",
    listings: [
      {
        id: security,
        ticker,
        bindings: [
          { plugin: "coinmarketcap", ref: refs[0] },
          { plugin: "coingecko", ref: refs[1] },
        ],
      },
    ],
  };
}

/** Directory order stands in for prominence among equal matches. */
export const demoInstruments: readonly Instrument[] = [
  {
    security: "security:isin:NL0010273215",
    name: "ASML Holding N.V.",
    kind: "ordinary",
    listings: [
      {
        id: "listing:isin:NL0010273215:XAMS:EUR",
        ticker: "ASML",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        country: "NL",
        bindings: [yahoo("ASML.AS"), eodhd("ASML.AS")],
      },
      // The New York Registry Shares fold into the company row.
      {
        id: "listing:isin:USN070592100:XNAS:USD",
        ticker: "ASML",
        mic: "XNAS",
        venue: "Nasdaq",
        country: "US",
        bindings: [yahoo("ASML"), eodhd("ASML.US")],
      },
      {
        id: "listing:isin:NL0010273215:XETR:EUR",
        ticker: "ASME",
        mic: "XETR",
        venue: "Xetra",
        country: "DE",
      },
      {
        id: "listing:isin:NL0010273215:OTCM:USD",
        ticker: "ASMLF",
        mic: "OTCM",
        venue: "OTC Markets",
        country: "US",
        bindings: [yahoo("ASMLF")],
      },
    ],
  },
  {
    security: "security:isin:NL0000334118",
    name: "ASM International N.V.",
    kind: "ordinary",
    listings: [
      {
        id: "listing:isin:NL0000334118:XAMS:EUR",
        ticker: "ASM",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        country: "NL",
        bindings: [yahoo("ASM.AS")],
      },
    ],
  },
  // Share classes are different instruments: one row each.
  {
    security: "security:isin:US02079K3059",
    name: "Alphabet Inc.",
    kind: "ordinary",
    listings: [
      {
        id: "listing:isin:US02079K3059:XNAS:USD",
        ticker: "GOOGL",
        mic: "XNAS",
        venue: "Nasdaq",
        country: "US",
      },
    ],
  },
  {
    security: "security:isin:US02079K1079",
    name: "Alphabet Inc.",
    kind: "ordinary",
    listings: [
      {
        id: "listing:isin:US02079K1079:XNAS:USD",
        ticker: "GOOG",
        mic: "XNAS",
        venue: "Nasdaq",
        country: "US",
      },
    ],
  },
  {
    security: "security:isin:IE00B4L5Y983",
    name: "iShares Core MSCI World UCITS ETF",
    kind: "etf",
    listings: [
      {
        id: "listing:isin:IE00B4L5Y983:XAMS:EUR",
        ticker: "IWDA",
        mic: "XAMS",
        venue: "Euronext Amsterdam",
        country: "NL",
      },
      {
        id: "listing:isin:IE00B4L5Y983:XLON:GBP",
        ticker: "SWDA",
        mic: "XLON",
        venue: "London Stock Exchange",
        country: "GB",
      },
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
    security: "index:demo:AEX",
    name: "AEX Index",
    kind: "index",
    listings: [
      {
        id: "index:demo:AEX",
        ticker: "AEX",
        venue: "Euronext Amsterdam",
        country: "NL",
      },
    ],
  },
  {
    security: "fx:demo:EURUSD",
    name: "Euro / US Dollar",
    kind: "fx",
    listings: [{ id: "fx:demo:EURUSD", ticker: "EUR/USD" }],
  },
];

export const demoLookupOffers: SearchResponse["lookup"] = [
  { plugin: "yahoo", label: "Yahoo Finance" },
];

/** The row an instrument shows: an exactly typed ticker picks its listing,
 * otherwise the primary one. */
function demoRow(instrument: Instrument, query: string): SearchRow {
  const typed = query.toUpperCase();
  const [primary, ...rest] = instrument.listings;
  const listing =
    rest.find((line) => line.ticker === typed) ?? primary ?? rest[0];
  if (!listing) throw Error(`${instrument.security} has no listing`);
  return {
    mic: null,
    venue: null,
    country: null,
    bindings: [],
    ...listing,
    security: instrument.security,
    name: instrument.name,
    kind: instrument.kind,
    listings: instrument.listings.length - 1,
  };
}

/** 0 exact ticker or ISIN, 1 ticker prefix, 2 name word prefix, 3 name text. */
function score({ security, name, listings }: Instrument, query: string) {
  const q = query.toLowerCase();
  const tickers = listings.map((line) => line.ticker.toLowerCase());
  const isin = security.startsWith("security:isin:")
    ? security.slice(14).toLowerCase()
    : undefined;
  const lower = name.toLowerCase();
  if (tickers.includes(q) || isin === q) return 0;
  if (tickers.some((ticker) => ticker.startsWith(q))) return 1;
  if (lower.split(/[\s/.]+/).some((word) => word.startsWith(q))) return 2;
  return lower.includes(q) ? 3 : undefined;
}

export function searchDemoDirectory(
  query: string,
  {
    kinds,
    limit = 20,
  }: { kinds?: readonly InstrumentKind[] | undefined; limit?: number } = {},
): SearchResponse {
  const rows = demoInstruments
    .map((instrument, order) => ({
      instrument,
      order,
      score: score(instrument, query),
    }))
    .filter(
      (entry): entry is typeof entry & { score: number } =>
        entry.score !== undefined &&
        (!kinds || kinds.includes(entry.instrument.kind)),
    )
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => demoRow(entry.instrument, query));
  return { rows, lookup: demoLookupOffers };
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
    return [demoLookupRow(query.toUpperCase().slice(0, 12))];
  };
}

export function demoLookupRow(symbol: string): SearchRow {
  return {
    id: `listing:demo:${symbol}`,
    security: `security:demo:${symbol}`,
    ticker: symbol,
    name: `${symbol} (synthetic lookup result)`,
    kind: "ordinary",
    mic: null,
    venue: null,
    country: null,
    listings: 0,
    bindings: [{ plugin: "yahoo", ref: symbol }],
  };
}
