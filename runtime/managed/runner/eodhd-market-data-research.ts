/** Bounded catalogue metadata and research content through official SDK 1.1.0.
 * Endpoint contracts: eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours,
 * stock-market-financial-news-api and stock-etfs-fundamental-data-feeds.
 */
import { createHash } from "node:crypto";
import type { Client, Result } from "./eodhd-market-data-operations.js";
import { financialFacts } from "./eodhd-market-data-fundamentals.js";
import {
  record,
  text,
  symbol,
  rows,
  type Row,
} from "./eodhd-market-data-values.js";

// EODHD exchange codes; AS is Euronext Amsterdam (operating MIC XAMS).
const EXCHANGES = ["AS", "NASDAQ", "NYSE", "LSE", "XETRA", "FOREX"];
const US_VENUES = new Set([
  "NASDAQ",
  "NYSE",
  "NYSE ARCA",
  "NYSE MKT",
  "BATS",
  "AMEX",
]);
function evidenceUrl(path: string, parameters: Record<string, string>) {
  const target = new URL(path, "https://eodhd.com");
  target.search = new URLSearchParams(parameters).toString();
  return target.href;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function bounded(value: unknown): Result {
  if (Buffer.byteLength(JSON.stringify(value)) > 1_900_000)
    throw Error("output_limit");
  return { data: value, issues: [], complete: true };
}
function url(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
function iso(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  )
    return null;
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}
function day(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return new Date(value).toISOString().slice(0, 10) === value ? value : null;
}
function newsWindow(args: Row) {
  const end =
    args.to === undefined
      ? new Date().toISOString().slice(0, 10)
      : day(args.to);
  if (!end) throw Error("invalid_window");
  const start =
    args.from === undefined
      ? new Date(Date.parse(end) - 30 * 86_400_000).toISOString().slice(0, 10)
      : day(args.from);
  if (
    !start ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 366 * 86_400_000
  )
    throw Error("invalid_window");
  return { start, end };
}
function native(value: unknown) {
  const item = record(value);
  if (item.provider !== "eodhd" || item.native_scope !== "catalogue")
    throw Error("invalid_request");
  const qualifiers =
    item.qualifiers === undefined ? {} : record(item.qualifiers);
  if (Object.keys(qualifiers).some((key) => key !== "currency"))
    throw Error("invalid_request");
  return { value: item, ticker: symbol(item.native_id) };
}
function catalogueRow(row: Row, scope: string) {
  const code = text(row.Code, 64);
  if (!code) throw Error("invalid_response");
  // US is an API namespace. Exchange is the actual returned venue.
  const namespace = US_VENUES.has(scope) ? "US" : scope;
  return {
    symbol: symbol(`${code}.${namespace}`),
    name: text(row.Name),
    type: text(row.Type),
    currency: text(row.Currency, 3),
    isin: text(row.Isin, 12),
    actual_venue: text(row.Exchange, 32),
  };
}
export async function research(
  sdk: Client,
  operation: string,
  args: Row,
): Promise<Result> {
  if (operation === "catalogue_snapshot") {
    if (typeof args.scope !== "string" || !EXCHANGES.includes(args.scope))
      throw Error("invalid_request");
    const scope = args.scope;
    const values = rows(await sdk.exchanges.symbols(scope), 60_000).map((row) =>
      catalogueRow(row, scope),
    );
    const keys = values.map((row) => row.symbol);
    if (new Set(keys).size !== keys.length) throw Error("identifier_conflict");
    return bounded({
      rows: values,
      scope,
      version: hash(values),
      observed_at: new Date().toISOString(),
    });
  }
  const selection = native(args.native_ref);
  if (operation === "news") {
    const limit = args.limit ?? 12;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 30)
      throw Error("invalid_request");
    // Unbounded native news queries can scan years of history even for a small
    // limit. Bound the intended recent feed at the provider; expose that scope.
    const window = newsWindow(args);
    const values = rows(
      await sdk.news({
        s: selection.ticker,
        limit: Number(limit),
        offset: 0,
        from: window.start,
        to: window.end,
      }),
      Number(limit),
    );
    const articles = values.flatMap((item) => {
      const link = url(item.link),
        title = text(item.title, 512),
        published = iso(item.date);
      if (!link || !title || !published) return [];
      return [
        {
          id: hash([link, published]),
          title,
          url: link,
          published_at: published,
          symbols: Array.isArray(item.symbols)
            ? item.symbols
                .filter(
                  (value): value is string =>
                    typeof value === "string" && text(value, 100) !== null,
                )
                .slice(0, 100)
            : [],
        },
      ];
    });
    const result = bounded({
      dataset: "news",
      provider_ref: selection.value,
      observed_at: new Date().toISOString(),
      source_url: evidenceUrl("/api/news", {
        s: selection.ticker,
        from: window.start,
        to: window.end,
        limit: String(limit),
        offset: "0",
      }),
      window,
      articles,
      limitations: [
        "Headlines linked to the requested source ticker; an article may mention several companies. Full articles are not retained.",
        `Requested publication dates ${window.start} through ${window.end}, inclusive, with a limit of ${limit} headlines. This is not an exhaustive news history.`,
      ],
    });
    if (articles.length !== values.length) result.issues.push("invalid_value");
    return result;
  }
  if (operation === "fundamentals") {
    const limit = args.limit ?? 30;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 30)
      throw Error("invalid_request");
    // Filter at the provider, not a full multi-megabyte fundamentals document.
    const raw = record(
      await sdk.fundamentals(selection.ticker, { filter: "Financials" }),
    );
    const financials =
      raw.Financials === undefined ? raw : record(raw.Financials);
    const available = financialFacts(financials).sort(
      (a, b) =>
        String(record(b.period).end).localeCompare(
          String(record(a.period).end),
        ) ||
        String(a.metric).localeCompare(String(b.metric)) ||
        String(record(a.period).frequency).localeCompare(
          String(record(b.period).frequency),
        ),
    );
    const facts = available.slice(0, Number(limit));
    return bounded({
      dataset: "fundamentals",
      provider_ref: selection.value,
      observed_at: new Date().toISOString(),
      source_url:
        "https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds",
      facts,
      limitations: [
        "EODHD statement fields retain their provider taxonomy and currency. Period starts are not supplied; annual and quarterly periods are distinct. Missing values are omitted.",
        ...(available.length > facts.length
          ? [
              `Returned the ${facts.length} newest supported facts; additional supported statement records were omitted.`,
            ]
          : []),
      ],
    });
  }
  throw Error("invalid_request");
}
