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
      // Core reads registry shares as receipts too (one kind), so the label
      // names both.
      label: "Receipts and registry shares",
      listings: listings.filter((listing) => listing.folded),
    },
  ];
  return groups.filter((group) => group.listings.length > 0);
}

/**
 * What the instrument's lead line is, so order never implies a home: core's
 * decided primary is the home; with none, the lead is FIRDS' most liquid EU
 * line or its home is unknown. Core puts a primary first, so a lead that is
 * neither has no primary anywhere. A line without a venue (a crypto
 * deployment) has no home to know.
 */
function homeNote(
  listing: SubjectListing,
  listings: readonly SubjectListing[],
) {
  if (listing.primary) return "home";
  if (listing.most_liquid) return "most liquid EU line";
  const lead = listings.find((line) => !line.folded);
  return listing.mic && listing.id === lead?.id ? "home unknown" : null;
}

/** The venue, and on the lead line whether it is the home. */
export function listingVenue(
  listing: SubjectListing,
  listings: readonly SubjectListing[],
) {
  const venue = listing.venue ?? listing.mic;
  const note = homeNote(listing, listings);
  return note ? `${venue} (${note})` : venue;
}

/** "ASML · Euronext Amsterdam (home) · EUR": how a listing names itself. */
export function listingLabel(
  listing: SubjectListing,
  listings: readonly SubjectListing[],
) {
  return [
    listing.ticker ?? listing.mic ?? "Listing",
    listingVenue(listing, listings),
    listing.currency,
  ]
    .filter(Boolean)
    .join(" · ");
}
