/**
 * Synthetic companies for the investment search demonstration. Names,
 * tickers, venues and ISINs mirror public reference data so the cases are
 * recognisable; bindings are synthetic. There are no prices.
 */
import type { InstrumentKind, SearchRow } from "@pythia/market-data/search";

/** A company (or fund, or crypto asset) and all its listings: its main share
 * first (primary listing first), then other classes and receipts. */
export type Company = {
  id: string;
  name: string;
  kind: InstrumentKind;
  rows: SearchRow[];
};

export const yahoo = (ref: string) => ({ plugin: "yahoo", ref });
const eodhd = (ref: string) => ({ plugin: "eodhd", ref });

export function line(
  id: string,
  ticker: string,
  name: string,
  venue: string | null,
  fields: Partial<SearchRow> = {},
): SearchRow {
  return {
    id,
    ticker,
    name,
    kind: "ordinary",
    mic: null,
    venue,
    country: null,
    currency: null,
    bindings: [],
    ...fields,
  };
}

function coin(
  id: string,
  name: string,
  ticker: string,
  refs: [string, string],
): Company {
  return {
    id,
    name,
    kind: "coin",
    rows: [
      line(id, ticker, name, null, {
        kind: "coin",
        bindings: [
          { plugin: "coinmarketcap", ref: refs[0] },
          { plugin: "coingecko", ref: refs[1] },
        ],
      }),
    ],
  };
}

const ASML = "ASML Holding N.V.";
const ALPHABET = "Alphabet Inc.";
const SHELL = "Shell plc";

/** Directory order stands in for prominence among equal matches. */
export const demoCompanies: readonly Company[] = [
  {
    id: "issuer:lei:724500Y6DUVHQD6OXN27",
    name: ASML,
    kind: "ordinary",
    rows: [
      line(
        "listing:isin:NL0010273215:XAMS:EUR",
        "ASML",
        ASML,
        "Euronext Amsterdam",
        {
          mic: "XAMS",
          country: "NL",
          currency: "EUR",
          bindings: [yahoo("ASML.AS"), eodhd("ASML.AS")],
        },
      ),
      line("listing:isin:NL0010273215:XETR:EUR", "ASME", ASML, "Xetra", {
        mic: "XETR",
        country: "DE",
        currency: "EUR",
      }),
      line("listing:isin:NL0010273215:OTCM:USD", "ASMLF", ASML, "OTC Markets", {
        mic: "OTCM",
        country: "US",
        currency: "USD",
        bindings: [yahoo("ASMLF")],
      }),
      // The New York Registry Shares are a listing of the same company.
      line(
        "listing:isin:USN070592100:XNAS:USD",
        "ASML",
        `${ASML} New York Registry Shares`,
        "Nasdaq",
        {
          kind: "depositary_receipt",
          mic: "XNAS",
          country: "US",
          currency: "USD",
          bindings: [yahoo("ASML"), eodhd("ASML.US")],
        },
      ),
    ],
  },
  {
    id: "issuer:lei:724500JZ8AR61K2KJ639",
    name: "ASM International N.V.",
    kind: "ordinary",
    rows: [
      line(
        "listing:isin:NL0000334118:XAMS:EUR",
        "ASM",
        "ASM International N.V.",
        "Euronext Amsterdam",
        {
          mic: "XAMS",
          country: "NL",
          currency: "EUR",
          bindings: [yahoo("ASM.AS")],
        },
      ),
    ],
  },
  // Share classes are listings of one company, each with its class.
  {
    id: "issuer:lei:5493006MHB84DD0ZWV18",
    name: ALPHABET,
    kind: "ordinary",
    rows: [
      line(
        "listing:isin:US02079K3059:XNAS:USD",
        "GOOGL",
        `${ALPHABET} Class A`,
        "Nasdaq",
        {
          mic: "XNAS",
          country: "US",
          currency: "USD",
          bindings: [yahoo("GOOGL")],
        },
      ),
      line(
        "listing:isin:US02079K1079:XNAS:USD",
        "GOOG",
        `${ALPHABET} Class C`,
        "Nasdaq",
        {
          mic: "XNAS",
          country: "US",
          currency: "USD",
          bindings: [yahoo("GOOG")],
        },
      ),
      line(
        "listing:isin:US02079K3059:XETR:EUR",
        "ABEA",
        `${ALPHABET} Class A`,
        "Xetra",
        {
          mic: "XETR",
          country: "DE",
          currency: "EUR",
        },
      ),
      line(
        "listing:isin:US02079K1079:XETR:EUR",
        "ABEC",
        `${ALPHABET} Class C`,
        "Xetra",
        {
          mic: "XETR",
          country: "DE",
          currency: "EUR",
        },
      ),
    ],
  },
  {
    id: "issuer:lei:21380068P1DRHMJ8KU70",
    name: SHELL,
    kind: "ordinary",
    rows: [
      line(
        "listing:isin:GB00BP6MXD84:XAMS:EUR",
        "SHELL",
        SHELL,
        "Euronext Amsterdam",
        {
          mic: "XAMS",
          country: "NL",
          currency: "EUR",
          bindings: [yahoo("SHELL.AS")],
        },
      ),
      line(
        "listing:isin:GB00BP6MXD84:XLON:GBP",
        "SHEL",
        SHELL,
        "London Stock Exchange",
        {
          mic: "XLON",
          country: "GB",
          currency: "GBP",
          bindings: [yahoo("SHEL.L")],
        },
      ),
      line(
        "listing:isin:US7802593050:XNYS:USD",
        "SHEL",
        `${SHELL} American Depositary Shares`,
        "NYSE",
        {
          kind: "depositary_receipt",
          mic: "XNYS",
          country: "US",
          currency: "USD",
          bindings: [yahoo("SHEL")],
        },
      ),
      line("listing:isin:GB00BP6MXD84:XETR:EUR", "R6C0", SHELL, "Xetra", {
        mic: "XETR",
        country: "DE",
        currency: "EUR",
      }),
      line(
        "listing:isin:GB00BP6MXD84:OTCM:USD",
        "RYDAF",
        SHELL,
        "OTC Markets",
        {
          mic: "OTCM",
          country: "US",
          currency: "USD",
        },
      ),
    ],
  },
  // A fund or ETF is its own group, never its umbrella's.
  {
    id: "security:isin:IE00B4L5Y983",
    name: "iShares Core MSCI World UCITS ETF",
    kind: "etf",
    rows: [
      line(
        "listing:isin:IE00B4L5Y983:XAMS:EUR",
        "IWDA",
        "iShares Core MSCI World UCITS ETF",
        "Euronext Amsterdam",
        { kind: "etf", mic: "XAMS", country: "NL", currency: "EUR" },
      ),
      line(
        "listing:isin:IE00B4L5Y983:XLON:GBP",
        "SWDA",
        "iShares Core MSCI World UCITS ETF",
        "London Stock Exchange",
        { kind: "etf", mic: "XLON", country: "GB", currency: "GBP" },
      ),
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
    rows: [
      line("index:demo:AEX", "AEX", "AEX Index", "Euronext Amsterdam", {
        kind: "index",
        country: "NL",
      }),
    ],
  },
  {
    id: "fx:demo:EURUSD",
    name: "Euro / US Dollar",
    kind: "fx",
    rows: [
      line("fx:demo:EURUSD", "EUR/USD", "Euro / US Dollar", null, {
        kind: "fx",
      }),
    ],
  },
];
