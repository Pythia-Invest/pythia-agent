import type { SubjectSection } from "@pythia/market-data/subject";
import { describe, expect, it } from "vitest";
import { pageBlocks } from "../src/components/instrument/blocks";
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
