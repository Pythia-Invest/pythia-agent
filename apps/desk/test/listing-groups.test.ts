import type { SubjectListing } from "@pythia/market-data/subject";
import { describe, expect, it } from "vitest";
import {
  listingGroups,
  listingLabel,
  listingVenue,
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
    most_liquid: false,
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
    const asml = line("asml", { venue: "Euronext Amsterdam", mic: "XAMS" });
    expect(listingLabel(asml, [line("other"), asml])).toBe(
      "ASML · Euronext Amsterdam · EUR",
    );
  });
});

describe("the lead line's home", () => {
  it("calls a decided primary the home", () => {
    const asml = line("asml", {
      venue: "Euronext Amsterdam",
      mic: "XAMS",
      primary: true,
    });
    expect(listingLabel(asml, [asml])).toBe(
      "ASML · Euronext Amsterdam (home) · EUR",
    );
  });

  it("names why the most liquid EU line is priced, never as primary", () => {
    const race = line("race", { venue: "Tradegate", most_liquid: true });
    expect(listingLabel(race, [race])).toBe(
      "RACE · Tradegate (most liquid EU line) · EUR",
    );
  });

  it("says the home is unknown on the lead line when no primary is decided", () => {
    const shel = line("shel", { venue: "London Stock Exchange", mic: "XLON" });
    const xetr = line("r6c", { venue: "Xetra", mic: "XETR" });
    const adr = line("shel-us", { mic: "XNYS", folded: true });
    const listings = [shel, xetr, adr];
    expect(listings.map((listing) => listingVenue(listing, listings))).toEqual([
      "London Stock Exchange (home unknown)",
      "Xetra",
      "XNYS",
    ]);
    // A crypto deployment has no venue, so no home to know.
    const chain = line("usdc", { ticker: "USDC" });
    expect(listingLabel(chain, [chain])).toBe("USDC · EUR");
  });
});
