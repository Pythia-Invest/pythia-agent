/**
 * Synthetic companies for the investment search demonstration. Names,
 * tickers, venues and ISINs mirror public reference data so the cases are
 * recognisable. There are no prices.
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

export function line(
  id: string,
  ticker: string | null,
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
    ...fields,
  };
}

function coin(id: string, name: string, ticker: string): Company {
  return {
    id,
    name,
    kind: "coin",
    rows: [line(id, ticker, name, null, { kind: "coin" })],
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
  ),
  coin("security:caip19:eip155:1/slip44:60", "Ether", "ETH"),
  coin(
    "security:caip19:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501",
    "Solana",
    "SOL",
  ),
  // A lending pool a DeFi plugin introduced: its own group, no ticker, and
  // the plugin's label on its row.
  {
    id: "market:provisional:defillama:pool:demo-navi-usdc",
    name: "NAVI Lending USDC",
    kind: "market",
    rows: [
      line(
        "market:provisional:defillama:pool:demo-navi-usdc",
        null,
        "NAVI Lending USDC",
        null,
        { kind: "market", source: "DefiLlama" },
      ),
    ],
  },
  // A line that no longer trades: found, marked, and ranked below live ones.
  {
    id: "security:isin:NL0009508712",
    name: "Milkiland",
    kind: "ordinary",
    rows: [
      line("listing:isin:NL0009508712:XWAR:EUR", "MLK", "Milkiland", "Warsaw", {
        mic: "XWAR",
        country: "PL",
        currency: "EUR",
        delisted: true,
      }),
    ],
  },
  // A security none of whose lines has a ticker: one row, found by name or ISIN.
  {
    id: "security:isin:BG1100087987",
    name: "Aroma",
    kind: "ordinary",
    rows: [
      line(
        "listing:isin:BG1100087987:XBUL:EUR",
        null,
        "Aroma",
        "Bulgarian Stock Exchange",
        {
          mic: "XBUL",
          country: "BG",
          currency: "EUR",
          no_ticker: true,
        },
      ),
    ],
  },
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
