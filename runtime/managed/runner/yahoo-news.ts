/** An issuer's news from Yahoo's search endpoint, bounded to tagged items. */
import { symbols, type Client } from "./yahoo.js";
// Yahoo's search answers at most about 50 news items per query (measured
// 2026-09-28: 49-50; a newsCount of 300 returned none) and has no offset, so
// one query per bound symbol plus the name is the deepest read it allows.
const NEWS_PER_QUERY = 50;
const NEWS_CAPPED = 45;
const NEWS_SYMBOLS = 8;
const NEWS_DAYS = 31;
// The search news item fields and types the adapter knows (yahoo-finance2
// SearchNews, measured live). Anything else is reported as drift, not dropped.
const NEWS_FIELDS = new Set([
  "uuid",
  "title",
  "publisher",
  "link",
  "providerPublishTime",
  "type",
  "thumbnail",
  "relatedTickers",
]);
const NEWS_TYPES = new Set(["STORY", "VIDEO"]);
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,&'()-]{0,99}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;
function newsDay(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !DAY.test(value))
    throw Error("invalid_window");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw Error("invalid_window");
  return parsed;
}
function newsLink(value: unknown): string | null {
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
/** An issuer's news on Yahoo: one query per Yahoo symbol Pythia binds to the
 * issuer (home and US lines) and one for its name, keeping only items Yahoo
 * tags with one of those symbols within a dated window. Yahoo's tag is its own
 * "main" line (ASML and SHEL for ASML.AS and SHEL.L, NESN.SW for Nestlé's US
 * line) and its search is text search, so one listing symbol alone misses the
 * issuer's news. Untagged items are dropped, so free text cannot turn this into
 * a search. Unknown fields, types and unreadable items are counted as drift. */
export async function symbolNews(
  sdk: Client,
  code: string,
  extra: unknown,
  options: Record<string, unknown>,
) {
  if (
    Object.keys(options).some(
      (key) => !["name", "from", "to", "limit"].includes(key),
    )
  )
    throw Error("invalid_request");
  const bound = [
    ...new Set([code, ...(extra === undefined ? [] : symbols(extra))]),
  ];
  const limit = options.limit ?? 100;
  const name = options.name;
  if (
    bound.length > NEWS_SYMBOLS ||
    !Number.isInteger(limit) ||
    Number(limit) < 1 ||
    Number(limit) > 200 ||
    (name !== undefined && (typeof name !== "string" || !NAME.test(name)))
  )
    throw Error("invalid_request");
  const today = Date.parse(
    `${new Date().toISOString().slice(0, 10)}T00:00:00Z`,
  );
  const last = newsDay(options.to, today);
  const first = newsDay(options.from, last - 6 * 86_400_000);
  if (first > last || last - first >= NEWS_DAYS * 86_400_000)
    throw Error("invalid_window");
  const start = first,
    end = last + 86_400_000;
  const queries = [
    ...bound.map((query) => ({ query, kind: "symbol" })),
    ...(typeof name === "string" ? [{ query: name, kind: "name" }] : []),
  ];
  const answers = await Promise.all(
    queries.map((entry) =>
      sdk.search(entry.query, {
        quotesCount: 0,
        newsCount: NEWS_PER_QUERY,
        enableFuzzyQuery: false,
        enableCb: false,
        enableNavLinks: false,
      }),
    ),
  );
  const tags = new Set(bound);
  const drift = {
    unknown_fields: new Set<string>(),
    unknown_types: new Set<string>(),
    unreadable_items: 0,
  };
  const kept = new Map<string, Record<string, unknown>>();
  let outside = 0;
  let completeFrom: number | null = null;
  const report = queries.map((entry, index) => {
    const news = Array.isArray(answers[index]?.news) ? answers[index].news : [];
    if (!Array.isArray(answers[index]?.news))
      drift.unknown_fields.add("news (not a list)");
    let oldest: number | null = null;
    for (const item of news as unknown[]) {
      const row =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      for (const key of Object.keys(row))
        if (!NEWS_FIELDS.has(key)) drift.unknown_fields.add(key.slice(0, 64));
      const at =
        row.providerPublishTime instanceof Date
          ? row.providerPublishTime.getTime()
          : Number.NaN;
      const link = newsLink(row.link);
      const related = row.relatedTickers;
      if (
        typeof row.uuid !== "string" ||
        !row.uuid ||
        row.uuid.length > 128 ||
        typeof row.title !== "string" ||
        !row.title.trim() ||
        !link ||
        !Number.isFinite(at) ||
        (related !== undefined &&
          (!Array.isArray(related) ||
            related.some((tag) => typeof tag !== "string")))
      ) {
        drift.unreadable_items++;
        continue;
      }
      if (typeof row.type === "string" && !NEWS_TYPES.has(row.type))
        drift.unknown_types.add(row.type.slice(0, 32));
      oldest = oldest === null ? at : Math.min(oldest, at);
      const hits = ((related as string[] | undefined) ?? []).filter((tag) =>
        tags.has(tag),
      );
      if (!hits.length) continue;
      if (at < start || at >= end) {
        outside++;
        continue;
      }
      const known = kept.get(row.uuid);
      if (known) continue;
      kept.set(row.uuid, {
        uuid: row.uuid,
        title: row.title.slice(0, 512),
        publisher: typeof row.publisher === "string" ? row.publisher : null,
        link,
        published_at: new Date(at).toISOString(),
        type: typeof row.type === "string" ? row.type : null,
        matched: hits,
        related_tickers: (related as string[]).slice(0, 20),
      });
    }
    const capped = news.length >= NEWS_CAPPED;
    // A capped query may have left out items older than its oldest answer.
    if (capped && oldest !== null)
      completeFrom =
        completeFrom === null ? oldest : Math.max(completeFrom, oldest);
    return {
      query: entry.query,
      kind: entry.kind,
      returned: news.length,
      capped,
      oldest: oldest === null ? null : new Date(oldest).toISOString(),
    };
  });
  const all = [...kept.values()].sort((a, b) =>
    String(b.published_at).localeCompare(String(a.published_at)),
  );
  const incomplete = completeFrom !== null && completeFrom > start;
  const issues = [
    ...(drift.unreadable_items ? ["invalid_value"] : []),
    ...(drift.unknown_fields.size || drift.unknown_types.size
      ? ["schema_drift"]
      : []),
    ...(incomplete ? ["window_incomplete"] : []),
    ...(all.length > Number(limit) ? ["truncated"] : []),
  ];
  return {
    issues,
    result: {
      symbol: code,
      symbols: bound,
      name: typeof name === "string" ? name : null,
      window: {
        from: new Date(start).toISOString().slice(0, 10),
        to: new Date(last).toISOString().slice(0, 10),
      },
      // Items at or after this instant are as complete as Yahoo's per-query
      // cap allows; null when no query reached the cap.
      complete_from:
        completeFrom === null ? null : new Date(completeFrom).toISOString(),
      queries: report,
      outside_window: outside,
      drift: {
        unknown_fields: [...drift.unknown_fields].sort(),
        unknown_types: [...drift.unknown_types].sort(),
        unreadable_items: drift.unreadable_items,
      },
      news: all.slice(0, Number(limit)),
    },
  };
}
