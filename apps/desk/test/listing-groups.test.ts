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
    country: null,
    otc: false,
    home: null,
    ...fields,
  };
}

const groups = (listings: SubjectListing[]) =>
  listingGroups(listings).map((group) => [
    group.key,
    group.listings.map((listing) => listing.id),
  ]);

describe("instrument listing groups", () => {
  it("puts home lines first, other exchanges next, OTC and receipts last", () => {
    expect(
      groups([
        line("xams", { primary: true, home: true, country: "NL" }),
        line("xetr", { home: false, country: "DE" }),
        line("asmlf", { home: false, otc: true, country: "US" }),
        line("adr", { home: false, kind: "depositary_receipt", country: "US" }),
        line("xnas", { home: false, country: "US" }),
      ]),
    ).toEqual([
      ["home", ["xams"]],
      ["exchanges", ["xetr", "xnas"]],
      ["otc", ["asmlf", "adr"]],
    ]);
  });

  it("keeps the primary line at home even away from the issuer's country", () => {
    // Shell's primary line is in Amsterdam while the issuer is British
    // (core: home=false); it still leads the selector.
    expect(
      groups([
        line("shell", { primary: true, home: false, country: "NL" }),
        line("shel", { kind: "depositary_receipt", country: "US" }),
      ]),
    ).toEqual([
      ["home", ["shell"]],
      ["otc", ["shel"]],
    ]);
  });

  it("names a listing by ticker, venue and currency", () => {
    expect(
      listingLabel(line("asml", { venue: "Euronext Amsterdam", mic: "XAMS" })),
    ).toBe("ASML · Euronext Amsterdam · EUR");
  });
});
