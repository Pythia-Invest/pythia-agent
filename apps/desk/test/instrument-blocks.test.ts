import type { SubjectSection } from "@pythia/market-data/subject";
import { describe, expect, it } from "vitest";
import {
  groupReports,
  newestPerAuthority,
  pageBlocks,
  usingSource,
} from "../src/components/instrument/blocks";
const yahoo = {
  provider: "yahoo",
  native_scope: "symbol",
  native_id: "SYN.AS",
};
function section(
  type: string,
  overrides: Partial<SubjectSection> = {},
): SubjectSection {
  return {
    section: type,
    plugin: "pythia-yahoo-discovery",
    label: "Yahoo Finance",
    status: "ready",
    binding: yahoo,
    request: null,
    alternatives: [],
    reason: null,
    skipped: [],
    ...overrides,
  };
}

describe("instrument page composition", () => {
  it("shares one price card only when quote and chart read the same address", () => {
    const merged = pageBlocks([
      section("profile", { plugin: "pythia-gleif", binding: null }),
      section("chart"),
      section("quote"),
    ]);
    expect(merged.map((block) => block.type)).toEqual(["market", "profile"]);
    expect(merged[0]?.sections.map((item) => item.section)).toEqual([
      "quote",
      "chart",
    ]);
    // A chart still being resolved, or from another source, keeps its own
    // card so its status stays visible.
    for (const chart of [
      section("chart", { status: "resolving", binding: null }),
      section("chart", {
        plugin: "pythia-eodhd",
        binding: { ...yahoo, provider: "eodhd" },
      }),
    ])
      expect(pageBlocks([section("quote"), chart]).map((b) => b.type)).toEqual([
        "quote",
        "chart",
      ]);
    // Section types this Desk cannot render get a labelled placeholder card.
    expect(pageBlocks([section("news")]).map((block) => block.type)).toEqual([
      "other",
    ]);
  });
});

describe("using an alternative source once", () => {
  it("reads every section of the card from the chosen alternative, and only it", () => {
    const eodhd = {
      provider: "eodhd",
      native_scope: "catalogue",
      native_id: "SYN.AS",
    };
    const also = {
      plugin: "pythia-eodhd",
      label: "EODHD",
      status: "ready",
      binding: eodhd,
      request: null,
      unaudited: true,
    };
    const [block] = pageBlocks([
      section("quote", { alternatives: [also], notice: null }),
      section("chart", { alternatives: [also], unaudited: false }),
    ]);
    if (!block) throw Error("expected a price card");
    const used = usingSource(block, "pythia-eodhd");
    // The source used once carries its own sign-off label, not the lead's.
    expect(
      used.sections.map((item) => [item.plugin, item.binding, item.unaudited]),
    ).toEqual([
      ["pythia-eodhd", eodhd, true],
      ["pythia-eodhd", eodhd, true],
    ]);
    expect(used.key).not.toEqual(block.key);
    expect(usingSource(block, null)).toBe(block);
    expect(usingSource(block, "pythia-unknown").sections).toEqual(
      block.sections,
    );
  });
});

describe("combined filings rows", () => {
  it("keep each authority's newest filing in view, newest first", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `6-K ${index}`,
        authority: "sec",
      })),
      { id: "ESEF 2025", authority: "oam-nl" },
      { id: "ESEF 2024", authority: "oam-nl" },
    ];
    const shown = newestPerAuthority(rows, 10);
    expect(shown).toHaveLength(10);
    expect(shown.at(-1)?.id).toBe("ESEF 2025");
    expect(shown.slice(0, 9).map((row) => row.id)).toEqual(
      rows.slice(0, 9).map((row) => row.id),
    );
    expect(newestPerAuthority(rows.slice(0, 3), 10)).toEqual(rows.slice(0, 3));
  });
});

describe("filings reports", () => {
  it("group a report's versions under its newest, never merging them", () => {
    const annual = "issuer|annual|2025-12-31|sec";
    const rows = [
      { id: "8-K", report_key: null },
      { id: "10-K/A", report_key: annual },
      { id: "ESEF", report_key: "issuer|annual|2025-12-31|oam-nl" },
      { id: "10-K", report_key: annual },
      { id: "6-K", report_key: null },
    ];
    expect(
      groupReports(rows).map((group) => group.map((row) => row.id)),
    ).toEqual([["8-K"], ["10-K/A", "10-K"], ["ESEF"], ["6-K"]]);
  });
});
