import type { SubjectListing } from "@pythia/market-data/subject";
import { describe, expect, it } from "vitest";
import {
  listingGroups,
  listingLabel,
} from "../src/components/instrument/listing-groups";

function line(
  id: string,
  fields: Partial<SubjectListing> = {},
): SubjectListing {
  return {
    id,
    ticker: id.toUpperCase(),
    mic: null,
    venue: null,
    currency: "EUR",
    primary: false,
    kind: "ordinary",
    folded: false,
    ...fields,
  };
}

const groups = (listings: SubjectListing[]) =>
  listingGroups(listings).map((group) => [
    group.key,
    group.listings.map((listing) => listing.id),
  ]);

describe("instrument listing groups", () => {
  it("lists the security's own lines, then what folds into it, in core's order", () => {
    expect(
      groups([
        line("xams", { primary: true }),
        line("xetr"),
        line("asmlf"),
        line("xnas", { kind: "depositary_receipt", folded: true }),
        line("asmf", { kind: "depositary_receipt", folded: true }),
      ]),
    ).toEqual([
      ["own", ["xams", "xetr", "asmlf"]],
      ["folded", ["xnas", "asmf"]],
    ]);
  });

  it("leaves out an empty group", () => {
    expect(groups([line("googl", { primary: true }), line("abea")])).toEqual([
      ["own", ["googl", "abea"]],
    ]);
  });

  it("names a listing by ticker, venue and currency", () => {
    expect(
      listingLabel(line("asml", { venue: "Euronext Amsterdam", mic: "XAMS" })),
    ).toBe("ASML · Euronext Amsterdam · EUR");
  });
});
