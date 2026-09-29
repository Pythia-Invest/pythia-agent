import type { MoverRow } from "@pythia/market-data/markets";
import type { SubjectPage } from "@pythia/market-data/subject";
import type { DayRow } from "@pythia/market-data/widgets";
import type { InstrumentDisplay } from "@pythia/ui";

/** What a card or watchlist row shows for a subject: core's chosen quote
 * source (the instrument page's own selection) and the read that follows it,
 * or why no source can serve it. */
export type SubjectQuote =
  | { row: DayRow; source: string; reason?: undefined }
  | { row?: undefined; source?: string | undefined; reason: string };

/** Ticker and name for a listing or security; a market subject (an index, a
 * future, a pair, a yield) has no ticker, so its name leads and its catalogue
 * description follows. */
export function subjectLabel(page: SubjectPage) {
  const ticker = page.identifiers.ticker;
  return ticker
    ? { symbol: ticker, name: page.subject.name }
    : {
        symbol: page.subject.name,
        name: page.subject.description ?? undefined,
      };
}

export function subjectQuote(page: SubjectPage): SubjectQuote {
  const quote = page.sections.find((section) => section.section === "quote");
  const label = subjectLabel(page);
  if (quote?.status === "ready" && quote.binding)
    return {
      row: {
        subject: quote.binding,
        symbol: label.symbol.slice(0, 64),
        name: label.name ?? page.subject.name,
      },
      source: quote.label,
    };
  return {
    source: quote?.label,
    reason:
      quote?.reason ??
      quote?.skipped[0]?.reason ??
      "No installed source can show a price for this.",
  };
}

/** A card or watchlist row as read. Its path's hover says where the price
 * comes from and how late it is, in words; the read's provenance stays on the
 * instrument page. A currency pair shows its pips (two decimals for yen-style
 * quotes). */
export function dayItem(
  row: InstrumentDisplay,
  subject: string,
  source: string | undefined,
): InstrumentDisplay {
  const { data, delayMinutes } = row.activity ?? {};
  const state =
    data === "stale"
      ? "updates unavailable"
      : data === "delayed"
        ? delayMinutes
          ? `${delayMinutes} min delayed`
          : "delayed"
        : undefined;
  const path = row.path && {
    ...row.path,
    label: [source ?? "Price history", state].filter(Boolean).join(" · "),
    ...(row.path.baseline
      ? {
          baseline: {
            ...row.path.baseline,
            label: row.path.baseline.label.split(" · ")[0] ?? "",
          },
        }
      : {}),
  };
  return {
    ...row,
    id: subject,
    ...(subject.startsWith("fx:")
      ? { precision: (row.price ?? 0) >= 50 ? 2 : 4 }
      : {}),
    ...(path ? { path } : {}),
  };
}

/** A row that cannot be priced: its identity and why, with no values. */
export function unavailableItem(
  id: string,
  symbol: string,
  name: string | undefined,
  reason: string,
): InstrumentDisplay {
  return {
    id,
    ticker: symbol,
    name,
    price: null,
    status: "unavailable",
    activity: { session: "unknown", data: "unavailable" },
    statusLabel: reason,
    description: reason,
    pathState: "unavailable",
  };
}

const KINDS: Record<string, string> = {
  listing: "Listing",
  security: "Security",
  issuer: "Company",
  index: "Index",
  fx: "Currency pair",
  series: "Rate or series",
  market: "Market",
};

/** What a row calls a subject its page has not named: core's curated name,
 * else its kind in words. Never the subject ID. */
export function subjectName(subject: string, names: Record<string, string>) {
  if (names[subject]) return names[subject];
  if (subject.startsWith("security:caip19:")) return "Crypto asset";
  return KINDS[subject.split(":", 1)[0] ?? ""] ?? "Subject";
}

/** A row whose page is still being read: whatever identity is known, no
 * values and no status yet. */
export function loadingItem(
  id: string,
  symbol: string,
  name: string | undefined,
): InstrumentDisplay {
  return {
    id,
    ticker: symbol,
    name,
    price: null,
    status: "unknown",
    statusLabel: "Loading quote",
    description: "Loading quote",
    pathState: "loading",
  };
}

/** The rows carry regular-session values, so after-hours reads as closed. */
const SESSION = {
  pre: "pre",
  regular: "open",
  post: "closed",
  closed: "closed",
} as const;

/** A movers row as supplied: its regular-session price and change against the
 * previous close, the market's state and the quote time. Before the open the
 * values are the last session's. */
export function moverItem(
  row: MoverRow,
  source: string,
  time: string,
): InstrumentDisplay {
  const session =
    SESSION[(row.session ?? "") as keyof typeof SESSION] ?? "unknown";
  return {
    id: `${row.rank}:${row.symbol}`,
    ticker: row.symbol,
    name: row.name ?? undefined,
    price: row.price,
    unit: row.currency,
    change: {
      absolute: row.change,
      percent: row.change_percent,
      basis: "Since the previous close",
    },
    status: "unknown",
    activity: { session, data: session === "pre" ? "previous" : "snapshot" },
    statusLabel: "",
    description: [
      source,
      row.venue,
      `quote ${time}`,
      row.volume != null
        ? `volume ${row.volume.toLocaleString("en-US")}`
        : null,
      row.unresolved,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
