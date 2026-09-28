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
    blocks.push({
      key: `${section.section}:${section.plugin}`,
      type,
      title: TITLES[type] ?? section.section.replaceAll("_", " "),
      sections: merged && section === quote ? [quote, chart] : [section],
    });
  }
  return blocks.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
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
