import type { SubjectSection } from "@pythia/market-data/subject";

/** One card of the instrument page: usually one section; a quote and chart
 * served by the same source through the same address share one market card. */
export type PageBlock = {
  key: string;
  type: "market" | "quote" | "chart" | "live" | "profile" | "filings" | "other";
  title: string;
  sections: SubjectSection[];
};

const TITLES: Record<string, string> = {
  market: "Price",
  quote: "Quote",
  chart: "Chart",
  live: "Live",
  profile: "Profile",
  filings: "Filings",
};
const ORDER = [
  "market",
  "quote",
  "chart",
  "live",
  "profile",
  "filings",
  "other",
];

function sameAddress(a: SubjectSection, b: SubjectSection) {
  return (
    a.plugin === b.plugin &&
    a.status === "ready" &&
    b.status === "ready" &&
    JSON.stringify(a.binding) === JSON.stringify(b.binding)
  );
}

export function pageBlocks(sections: readonly SubjectSection[]): PageBlock[] {
  const quote = sections.find((section) => section.section === "quote");
  const chart = sections.find((section) => section.section === "chart");
  const merged = quote && chart && sameAddress(quote, chart);
  const blocks: PageBlock[] = [];
  for (const section of sections) {
    if (merged && section === chart) continue;
    const type =
      merged && section === quote
        ? "market"
        : section.section in TITLES
          ? (section.section as PageBlock["type"])
          : "other";
    // A listing no price source covers still has its price card, saying so.
    const uncovered = type === "quote" && section.status === "not_covering";
    blocks.push({
      key: `${section.section}:${section.plugin}`,
      type,
      title: uncovered
        ? "Price"
        : (TITLES[type] ?? section.section.replaceAll("_", " ")),
      sections: merged && section === quote ? [quote, chart] : [section],
    });
  }
  return blocks.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

/** An investor's use-once pick of an alternative source for one card. */
export type SourcePick = { plugin: string; subject: string };

/** The alternative a pick still reads, or null: a pick holds only for the
 * page subject (listing) it was made on, and only while core still offers
 * that source for the card. */
export function pickedSource(
  block: PageBlock,
  pick: SourcePick | null,
  subject: string,
): string | null {
  if (!pick || pick.subject !== subject) return null;
  const offered = block.sections.some((section) =>
    section.alternatives.some((item) => item.plugin === pick.plugin),
  );
  return offered ? pick.plugin : null;
}

/** A block's sections read from one alternative source instead, for this
 * view only: core's choice is not changed. */
export function usingSource(
  block: PageBlock,
  plugin: string | null,
): PageBlock {
  if (!plugin) return block;
  const sections = block.sections.map((section) => {
    const alternative = section.alternatives.find(
      (item) => item.plugin === plugin,
    );
    if (!alternative) return section;
    return {
      ...section,
      plugin: alternative.plugin,
      label: alternative.label,
      status: alternative.status,
      unaudited: alternative.unaudited,
      binding: alternative.binding ?? null,
      request: alternative.request ?? null,
      reason: null,
      sources: null,
      notice: null,
    };
  });
  return { ...block, key: `${block.key}:${plugin}`, sections };
}

/** One row per report: filings sharing a `report_key` (a report's format and
 * language versions, and its amendments) group under the newest, in core's
 * order. Grouping is display only; every filing stays. */
export function groupReports<T extends { report_key?: string | null }>(
  items: readonly T[],
): T[][] {
  const groups: T[][] = [];
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const group = item.report_key ? byKey.get(item.report_key) : undefined;
    if (group) {
      group.push(item);
      continue;
    }
    groups.push([item]);
    if (item.report_key) byKey.set(item.report_key, groups.at(-1) as T[]);
  }
  return groups;
}

/** The newest filings, keeping each authority's newest one in view so a
 * yearly ESEF report is not pushed out by frequent SEC 6-Ks; still newest
 * first as core ordered them. */
export function newestPerAuthority<T extends { authority?: string | null }>(
  items: readonly T[],
  count: number,
): T[] {
  const pinned = new Set<T>();
  const seen = new Set<string>();
  for (const item of items) {
    if (item.authority && !seen.has(item.authority)) {
      seen.add(item.authority);
      pinned.add(item);
    }
  }
  const room = Math.max(0, count - pinned.size);
  const rest = items.filter((item) => !pinned.has(item)).slice(0, room);
  const kept = new Set<T>([...pinned, ...rest]);
  return items.filter((item) => kept.has(item));
}

/** One filings row: a report's versions, the authorities it was filed
 * with, and the parallel reports of its period. */
export type PeriodRow<T> = {
  variants: T[];
  authorities: string[];
  parallels: PeriodRow<T>[];
};

/** Reports sharing a `report_period` (issuer, kind, period end) under
 * several authorities, made explicit (C3). The same source's same form filed
 * with several authorities is one report filed in each (an ESEF report in
 * the UK and the Netherlands): its rows join. Any other report of the period
 * is a parallel report (a SEC 20-F beside the ESEF report): rows stay apart
 * and each names the others. Display only; every filing stays. */
export function periodRows<
  T extends {
    report_period?: string | null;
    authority?: string | null;
    source?: string | null;
    form?: string | null;
  },
>(reports: readonly T[][]): PeriodRow<T>[] {
  const rows: PeriodRow<T>[] = [];
  const joined = new Map<string, PeriodRow<T>>();
  for (const variants of reports) {
    const first = variants[0];
    const key =
      first?.report_period &&
      [first.report_period, first.source, first.form].join("|");
    const row = key ? joined.get(key) : undefined;
    if (row) {
      row.variants.push(...variants);
      if (first?.authority && !row.authorities.includes(first.authority))
        row.authorities.push(first.authority);
      continue;
    }
    const created: PeriodRow<T> = {
      variants: [...variants],
      authorities: first?.authority ? [first.authority] : [],
      parallels: [],
    };
    rows.push(created);
    if (key) joined.set(key, created);
  }
  for (const row of rows) {
    const period = row.variants[0]?.report_period;
    if (!period) continue;
    row.parallels = rows.filter(
      (other) => other !== row && other.variants[0]?.report_period === period,
    );
  }
  return rows;
}
