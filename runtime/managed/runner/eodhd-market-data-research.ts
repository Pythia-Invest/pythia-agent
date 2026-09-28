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
// Fields of an EODHD news item (stock-market-financial-news-api). Anything else
// is reported as drift; `tags` and `sentiment` are known and not read.
const NEWS_FIELDS = new Set([
  "date",
  "title",
  "content",
  "link",
  "symbols",
  "tags",
  "sentiment",
]);
const NEWS_SYMBOLS = 8;
const CONTENT_LIMIT = 8000;
const ENTITY = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/iu;
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  eacute: "\u00e9",
  egrave: "\u00e8",
  aacute: "\u00e1",
  agrave: "\u00e0",
  ouml: "\u00f6",
  uuml: "\u00fc",
  auml: "\u00e4",
  szlig: "\u00df",
};
/** HTML character references in EODHD text ("Shell &amp; NGC"), decoded once.
 * An unknown named reference is left in place and counted as drift. */
export function decodeEntities(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(
    /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/giu,
    (whole, body: string) => {
      if (body[0] === "#") {
        const point =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : whole;
      }
      return NAMED[body] ?? NAMED[body.toLowerCase()] ?? whole;
    },
  );
}
function articleBody(value: unknown): { text: string; cut: boolean } | null {
  const decoded = decodeEntities(value);
  if (typeof decoded !== "string") return null;
  // Keep line structure; drop other control characters.
  const clean = [...decoded]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("");
  return clean.length > CONTENT_LIMIT
    ? { text: clean.slice(0, CONTENT_LIMIT), cut: true }
    : { text: clean, cut: false };
}
/** The requested ticker and the other EODHD tickers the caller binds to the
 * same issuer; only these are kept in an item's symbol list. */
function boundTickers(requested: string, value: unknown): Set<string> {
  if (value === undefined) return new Set([requested]);
  if (
    !Array.isArray(value) ||
    !value.length ||
    new Set(value).size !== value.length
  )
    throw Error("invalid_request");
  const bound = new Set([requested, ...value.map(symbol)]);
  if (bound.size > NEWS_SYMBOLS) throw Error("invalid_request");
  return bound;
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
    if (args.content !== undefined && typeof args.content !== "boolean")
      throw Error("invalid_request");
    const bound = boundTickers(selection.ticker, args.symbols);
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
    const drift = {
      unknown_fields: new Set<string>(),
      undecoded_entities: 0,
      unreadable_items: 0,
    };
    const articles = values.flatMap((item) => {
      for (const key of Object.keys(item))
        if (!NEWS_FIELDS.has(key)) drift.unknown_fields.add(key.slice(0, 64));
      // Links are HTML-escaped too ("?a=1&amp;b=2").
      const link = url(decodeEntities(item.link)),
        title = text(decodeEntities(item.title), 512),
        published = iso(item.date);
      if (!link || !title || !published) {
        drift.unreadable_items++;
        return [];
      }
      if (ENTITY.test(title)) drift.undecoded_entities++;
      const tags = Array.isArray(item.symbols)
        ? item.symbols.filter(
            (value): value is string =>
              typeof value === "string" && text(value, 100) !== null,
          )
        : [];
      if (item.symbols !== undefined && !Array.isArray(item.symbols))
        drift.unknown_fields.add("symbols (not a list)");
      const body = args.content === true ? articleBody(item.content) : null;
      return [
        {
          id: hash([link, published]),
          title,
          url: link,
          published_at: published,
          // EODHD lists up to 50 tickers per item, which is no evidence of
          // what an article is about: keep the requested and bound tickers,
          // and say how many others there were.
          symbols: tags.filter((tag) => bound.has(tag)),
          other_symbols: tags.filter((tag) => !bound.has(tag)).length,
          ...(args.content === true
            ? {
                content: body?.text ?? null,
                content_truncated: body?.cut ?? false,
              }
            : {}),
        },
      ];
    });
    const issues: string[] = [];
    if (drift.unreadable_items) issues.push("invalid_value");
    if (drift.unknown_fields.size || drift.undecoded_entities)
      issues.push("schema_drift");
    return {
      data: bounded({
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
        symbols: [...bound],
        articles,
        drift: {
          unknown_fields: [...drift.unknown_fields].sort(),
          undecoded_entities: drift.undecoded_entities,
          unreadable_items: drift.unreadable_items,
        },
        limitations: [
          "Headlines linked to the requested source ticker; an article may mention several companies. Only the requested and bound tickers are listed per item.",
          args.content === true
            ? `Article text is returned for this read only, up to ${CONTENT_LIMIT} characters per article, and is never stored.`
            : "Article text is not returned unless content is requested, and is never stored.",
          `Requested publication dates ${window.start} through ${window.end}, inclusive, with a limit of ${limit} headlines. This is not an exhaustive news history.`,
        ],
      }).data,
      issues,
      complete: true,
    };
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
