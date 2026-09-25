import type { SearchResponse, SearchRow } from "../src/search";

// Synthetic directory rows shaped like public reference identifiers. No prices.
export function row(values: Partial<SearchRow> & Pick<SearchRow, "row_id">) {
  return {
    kind: "equity",
    name: "Example Holding N.V.",
    ticker: values.row_id.toUpperCase(),
    is_primary: false,
    bindings: [],
    ...values,
  } satisfies SearchRow;
}

export const nasdaqLine = row({
  row_id: "listing:asml-xnas",
  ticker: "ASML",
  name: "ASML Holding N.V.",
  mic: "XNAS",
  venue_label: "NASDAQ",
  currency: "USD",
  security_id: "NL0010273215",
  bindings: [{ plugin: "yahoo", ref: "ASML" }],
});
export const amsterdamLine = row({
  row_id: "listing:asml-xams",
  ticker: "ASML",
  name: "ASML Holding N.V.",
  mic: "XAMS",
  venue_label: "Euronext Amsterdam",
  currency: "EUR",
  security_id: "NL0010273215",
  is_primary: true,
  bindings: [
    { plugin: "yahoo", ref: "ASML.AS" },
    { plugin: "eodhd", ref: "ASML.AS" },
  ],
});
export const depositaryLine = row({
  row_id: "listing:adyey",
  ticker: "ADYEY",
  name: "Adyen N.V. ADR",
  venue_label: "OTC Markets",
  security_id: "US00783V1044",
  is_primary: true,
  badges: ["ADR", "OTC"],
});
export const bitcoin = row({
  row_id: "crypto:bitcoin",
  kind: "crypto",
  ticker: "BTC",
  name: "Bitcoin",
  security_id: "crypto:bitcoin",
  is_primary: true,
  bindings: [{ plugin: "coinmarketcap", ref: "1" }],
});
export const euroDollar = row({
  row_id: "fx:eurusd",
  kind: "fx",
  ticker: "EUR/USD",
  name: "Euro / US Dollar",
});

/** The venue ranked first is deliberately not the primary listing. */
export const response: SearchResponse = {
  query: "a",
  results: [nasdaqLine, depositaryLine, amsterdamLine, bitcoin, euroDollar],
  snapshot: { version: "synthetic-1", as_of: "2026-09-24T00:00:00Z" },
  took_ms: 1,
};
