import type { SubjectListing } from "@pythia/market-data/subject";

export type ListingGroup = {
  key: "home" | "exchanges" | "otc";
  label: string;
  listings: SubjectListing[];
};

/** Over-the-counter lines and depositary receipts trade the same economic
 * shares away from the home exchange. */
function offExchange(listing: SubjectListing) {
  return listing.otc === true || listing.kind === "depositary_receipt";
}

/**
 * An instrument's listings for the page's selector: the home market, other
 * exchanges, then OTC lines and receipts. Home is core's `home` flag (a venue
 * in the issuer's country); without it, the primary listing's country. Supplied
 * order is kept within each group; empty groups are left out.
 */
export function listingGroups(
  listings: readonly SubjectListing[],
): ListingGroup[] {
  const primary = listings.find((listing) => listing.primary) ?? listings[0];
  const home = primary?.country ?? null;
  const groups: ListingGroup[] = [
    { key: "home", label: "Home market", listings: [] },
    { key: "exchanges", label: "Other exchanges", listings: [] },
    { key: "otc", label: "OTC & ADRs", listings: [] },
  ];
  for (const listing of listings) {
    const atHome =
      listing.home ??
      (listing === primary || (home !== null && listing.country === home));
    const group = offExchange(listing)
      ? groups[2]
      : atHome || listing === primary
        ? groups[0]
        : groups[1];
    group?.listings.push(listing);
  }
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
