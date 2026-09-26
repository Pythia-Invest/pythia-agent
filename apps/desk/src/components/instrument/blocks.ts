import type { SubjectSection } from "@pythia/market-data/subject";

/** One card of the instrument page: usually one section; a quote and chart
 * served by the same source through the same address share one market card. */
export type PageBlock = {
  key: string;
  type: "market" | "quote" | "chart" | "profile" | "filings" | "other";
  title: string;
  sections: SubjectSection[];
};

const TITLES: Record<string, string> = {
  market: "Price",
  quote: "Quote",
  chart: "Chart",
  profile: "Profile",
  filings: "Filings",
};
const ORDER = ["market", "quote", "chart", "profile", "filings", "other"];

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
