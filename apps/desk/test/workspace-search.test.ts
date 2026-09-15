import { describe, expect, it } from "vitest";
import { matchRanges } from "@/workspace/search";
import { filenameSearch } from "@/workspace/filename-search";
describe("workspace search matching", () => {
  it("ranks exact and literal names above typos and keeps folder scope useful", () => {
    const query = filenameSearch("scale");
    expect(query.score("scale.md", "scale.md")).toBeGreaterThan(
      query.score("scale-exact.md", "scale-exact.md"),
    );
    expect(query.score("scale-exact.md", "scale-exact.md")).toBeGreaterThan(
      query.score("my-scale.md", "my-scale.md"),
    );
    expect(query.score("my-scale.md", "my-scale.md")).toBeGreaterThan(
      query.score("scael.md", "scael.md"),
    );
    expect(
      filenameSearch("aur assumptinos").score(
        "Aurora/assumptions.md",
        "assumptions.md",
      ),
    ).toBeGreaterThan(0);
    expect(filenameSearch("aurora").score("Aurora/notes.md", "notes.md")).toBe(
      0,
    );
    expect(
      filenameSearch("company-0001").score(
        "company-0001/notes-0001.md",
        "notes-0001.md",
      ),
    ).toBe(0);
    expect(
      filenameSearch("company-0001 notes").score(
        "company-0001/notes-0001.md",
        "notes-0001.md",
      ),
    ).toBeGreaterThan(0);
    expect(
      filenameSearch('"scenario assumptions"').score(
        "scenario-assumptions.md",
        "scenario-assumptions.md",
      ),
    ).toBe(0);
    expect(filenameSearch("[risk]").score("risk.md", "risk.md")).toBe(0);
  });
  it("accepts one insertion, deletion, substitution or adjacent swap in a word", () => {
    for (const query of ["scael", "xcale", "scalz", "scalle"])
      expect(
        filenameSearch(query).score("scale.md", "scale.md"),
      ).toBeGreaterThan(0);
    // Five-character deletion query, including either edge of a word.
    for (const query of ["margi", "argin", "marin", "magrin"])
      expect(
        filenameSearch(query).score("margin.md", "margin.md"),
      ).toBeGreaterThan(0);
    expect(
      filenameSearch("scal").score("scale.md", "scale.md"),
    ).toBeGreaterThan(0);
    expect(
      filenameSearch("scael-exact").score(
        "scale_exact-target.md",
        "scale_exact-target.md",
      ),
    ).toBeGreaterThan(0);
    expect(filenameSearch("missing scael").score("scale.md", "scale.md")).toBe(
      0,
    );
  });
  it("rejects scattered letters, multiple edits and fuzzy numbers or short words", () => {
    for (const name of [
      "fictional-research-example",
      "s-c-a-l-e.md",
      "sxxle.md",
    ])
      expect(filenameSearch("scale").score(name, name)).toBe(0);
    expect(filenameSearch("calex").score("scale.md", "scale.md")).toBe(0);
    expect(
      filenameSearch("scl exct").score(
        "scale-exact-target.md",
        "scale-exact-target.md",
      ),
    ).toBe(0);
    expect(filenameSearch("riks").score("risk.md", "risk.md")).toBe(0);
    expect(filenameSearch('"scael"').score("scale.md", "scale.md")).toBe(0);
    expect(filenameSearch("20251").score("20241.md", "20241.md")).toBe(0);
    expect(
      filenameSearch("company-00001").score(
        "company-00002.md",
        "company-00002.md",
      ),
    ).toBe(0);
    expect(
      filenameSearch("scale").score("scale1.md", "scale1.md"),
    ).toBeGreaterThan(0);
    expect(filenameSearch("scael").score("scale1.md", "scale1.md")).toBe(0);
  });
  it("highlights corrected words and keeps Unicode offsets correct", () => {
    const text = "scale-exact-target.md";
    expect(
      filenameSearch("scael exact")
        .ranges(text)
        .map((range) => text.slice(...range))
        .join(""),
    ).toBe("scaleexact");
    expect(filenameSearch("magrin").ranges("İ margin.md")).toEqual([[2, 8]]);
    expect(filenameSearch("ΟΣ").ranges("ΟΣ.md")).toEqual([[0, 2]]);
    expect(filenameSearch("résmué").ranges("résumé.pdf")).toEqual([[0, 6]]);
    expect(filenameSearch("акция").ranges("акциия.md")).toEqual([[0, 6]]);
    expect(filenameSearch("a𐐨bcd").ranges("𐐨abcd.md")).toEqual([[0, 6]]);
  });
  it("keeps highlight offsets in original Unicode text and merges overlaps", () => {
    expect(matchRanges("ΟΣ", ["ΟΣ"])).toEqual([[0, 2]]);
    expect(matchRanges("İ margin", ["margin"])).toEqual([[2, 8]]);
    expect(matchRanges("İ", ["i"])).toEqual([[0, 1]]);
    expect(matchRanges("cash flow", ["cash", "cash flow"])).toEqual([[0, 9]]);
    expect(matchRanges("😀 margin", ["margin"])).toEqual([[3, 9]]);
  });
  it("maps many hits after a Unicode expansion without repeated whole-document scans", () => {
    const prefix = `İ${" ".repeat(2 * 1024 * 1024)}`;
    const text = prefix + "needle ".repeat(250);
    const started = performance.now();
    const ranges = matchRanges(text, ["needle"]);
    // A generous regression ceiling: repeated scans took several seconds;
    // the bounded forward scan takes tens of milliseconds on the same fixture.
    expect(performance.now() - started).toBeLessThan(1000);
    expect(ranges).toHaveLength(200);
    expect(ranges[0]).toEqual([prefix.length, prefix.length + 6]);
    expect(ranges.every((range) => text.slice(...range) === "needle")).toBe(
      true,
    );
  });
});
