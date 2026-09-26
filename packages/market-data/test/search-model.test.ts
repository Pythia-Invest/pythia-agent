import { describe, expect, it } from "vitest";
import { searchResponseSchema } from "../src/search";
import { demoLookup, searchDemoDirectory } from "../src/search-demo";
import { searchOptions, TYPE_FILTERS } from "../src/search-ui/search-model";

const signal = new AbortController().signal;

describe("search model", () => {
  it("keeps the directory's order and leads each security with its primary listing", () => {
    const options = searchOptions(
      searchDemoDirectory("asml").groups,
      "directory",
    );
    expect(
      options.map(({ row, lead, group }) => [
        row.ticker,
        row.mic,
        lead,
        group.kind,
      ]),
    ).toEqual([
      ["ASML", "XAMS", true, "ordinary"],
      ["ASME", "XETR", false, "ordinary"],
      ["ASMLF", "PINX", false, "ordinary"],
      // The New York Registry Shares are a separate security, never merged.
      ["ASML", "XNGS", true, "depositary_receipt"],
    ]);
  });

  it("asks the directory for every kind a type pill stands for", () => {
    const crypto = TYPE_FILTERS.find((type) => type.value === "crypto");
    const stocks = TYPE_FILTERS.find((type) => type.value === "stocks");
    expect(
      searchDemoDirectory("s", { kinds: crypto?.kinds }).groups.map(
        (group) => group.name,
      ),
    ).toEqual(["Solana"]);
    expect(
      searchDemoDirectory("asml", { kinds: stocks?.kinds }).groups,
    ).toHaveLength(2);
  });

  it("keeps the in-memory directory on the search contract", async () => {
    for (const query of ["asml", "btc", "IE00B4L5Y983", "zzzz"])
      expect(() =>
        searchResponseSchema.parse(searchDemoDirectory(query)),
      ).not.toThrow();
    const found = await demoLookup()({ plugin: "yahoo", query: "abc" }, signal);
    expect(() =>
      searchResponseSchema.parse({
        ...searchDemoDirectory("abc"),
        groups: found,
      }),
    ).not.toThrow();
  });
});
