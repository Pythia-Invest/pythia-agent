import type { SubjectSection } from "@pythia/market-data/subject";
import { describe, expect, it } from "vitest";
import {
  groupReports,
  newestPerAuthority,
  pageBlocks,
  periodRows,
  pickedSource,
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

  it("lapses on another listing, or once core no longer offers the source", () => {
    const also = {
      plugin: "pythia-eodhd",
      label: "EODHD",
      status: "ready",
      request: null,
    };
    const [offered] = pageBlocks([section("quote", { alternatives: [also] })]);
    const [gone] = pageBlocks([section("quote")]);
    if (!offered || !gone) throw Error("expected a quote card");
    const pick = { plugin: "pythia-eodhd", subject: "listing:a" };
    expect(pickedSource(offered, pick, "listing:a")).toBe("pythia-eodhd");
    // The card keeps its React state across a listing switch; the pick does not.
    expect(pickedSource(offered, pick, "listing:b")).toBeNull();
    expect(pickedSource(gone, pick, "listing:a")).toBeNull();
    expect(pickedSource(offered, null, "listing:a")).toBeNull();
  });

  it("names every source a combined list still shows after a pick", () => {
    const source = (name: string, authorities: string[]) => ({
      source: name,
      provider: name,
      plugin: `pythia-${name}`,
      authorities,
    });
    const [filings] = pageBlocks([
      section("filings", {
        sources: [
          source("xbrl-filings", ["fca", "oam-nl"]),
          source("sec", ["sec"]),
        ],
        alternatives: [
          {
            plugin: "pythia-nsm",
            label: "UK FCA NSM",
            status: "ready",
            authorities: ["fca"],
          },
        ],
      }),
    ]);
    if (!filings) throw Error("expected a filings card");
    const shown = usingSource(filings, "pythia-nsm").sections[0]?.sources;
    expect(shown?.map((item) => [item.source, item.authorities])).toEqual([
      ["UK FCA NSM", ["fca"]],
      ["xbrl-filings", ["oam-nl"]],
      ["sec", ["sec"]],
    ]);
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

  it("join one report filed in two places and name parallel reports", () => {
    const period = "issuer|annual|2025-12-31";
    const esef = (authority: string) => ({
      id: `ESEF ${authority}`,
      report_period: period,
      authority,
      source: "filings.xbrl.org",
      form: "ESEF",
    });
    const sec = {
      id: "20-F",
      report_period: period as string | null,
      authority: "sec",
      source: "SEC EDGAR",
      form: "20-F",
    };
    const event = { ...sec, id: "6-K", report_period: null, form: "6-K" };
    const rows = periodRows([[esef("fca")], [sec], [esef("oam-nl")], [event]]);
    expect(
      rows.map((row) => [
        row.variants.map((item) => item.id),
        row.authorities,
        row.parallels.map((other) => other.variants[0]?.id),
      ]),
    ).toEqual([
      [["ESEF fca", "ESEF oam-nl"], ["fca", "oam-nl"], ["20-F"]],
      [["20-F"], ["sec"], ["ESEF fca"]],
      [["6-K"], ["sec"], []],
    ]);
  });
});
