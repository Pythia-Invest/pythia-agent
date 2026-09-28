import type { SubjectListing } from "@pythia/market-data/subject";

export type ListingGroup = {
  key: "own" | "folded";
  label: string;
  listings: SubjectListing[];
};

/**
 * An instrument's listings for the page's selector, as core folds them: the
 * security's own lines, then the lines of what folds into it (depositary
 * receipts and registry shares). Core's order is kept within each group;
 * an empty group is left out.
 */
export function listingGroups(
  listings: readonly SubjectListing[],
): ListingGroup[] {
  const groups: ListingGroup[] = [
    {
      key: "own",
      label: "Listings",
      listings: listings.filter((listing) => !listing.folded),
    },
    {
      key: "folded",
      label: "Depositary receipts",
      listings: listings.filter((listing) => listing.folded),
    },
  ];
  return groups.filter((group) => group.listings.length > 0);
}

/** "ASML · Euronext Amsterdam · EUR": how a listing names itself. */
export function listingLabel(listing: SubjectListing) {
  return [
    listing.ticker ?? listing.mic ?? "Listing",
    listing.venue ?? listing.mic,
    listing.currency,
  ]
    .filter(Boolean)
    .join(" · ");
}
