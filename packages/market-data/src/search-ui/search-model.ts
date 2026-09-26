import type { InstrumentKind, SearchRow } from "../search";
import type { SubjectListing } from "../subject";

export type TypeFilter =
  | "all"
  | "stocks"
  | "etfs"
  | "crypto"
  | "funds"
  | "indices"
  | "currencies"
  | "bonds";

/** Type pills in display order, with the instrument kinds each one asks the
 * directory for. */
export const TYPE_FILTERS: readonly {
  value: TypeFilter;
  label: string;
  kinds?: InstrumentKind[];
}[] = [
  { value: "all", label: "All" },
  {
    value: "stocks",
    label: "Stocks",
    kinds: ["ordinary", "preferred", "depositary_receipt"],
  },
  { value: "etfs", label: "ETFs", kinds: ["etf"] },
  { value: "crypto", label: "Crypto", kinds: ["coin", "token"] },
  { value: "funds", label: "Funds", kinds: ["fund"] },
  { value: "indices", label: "Indices", kinds: ["index"] },
  { value: "currencies", label: "Currencies", kinds: ["fx"] },
  { value: "bonds", label: "Bonds", kinds: ["bond"] },
];

/** The precise instrument type, for the instrument page. */
export const KIND_LABELS: Record<InstrumentKind, string> = {
  ordinary: "Stock",
  preferred: "Preferred stock",
  depositary_receipt: "Depositary receipt",
  etf: "ETF",
  fund: "Fund",
  bond: "Bond",
  index: "Index",
  fx: "Currency",
  coin: "Crypto",
  token: "Token",
  other: "Other",
};

/** The plain type a result row shows; a receipt on its own reads as a stock. */
export const ROW_LABELS: Record<InstrumentKind, string> = {
  ...KIND_LABELS,
  preferred: "Preferred",
  depositary_receipt: "Stock",
  token: "Crypto",
};

export type RowSource = "directory" | "lookup" | "listing";

/** One line of an instrument, as its side list shows it. */
export type ListingChoice = Pick<
  SubjectListing,
  | "id"
  | "ticker"
  | "mic"
  | "venue"
  | "currency"
  | "kind"
  | "country"
  | "primary"
>;

/** One selectable row in panel order: an instrument, or (in an instrument's
 * side list) one of its listings. */
export type SearchOption = {
  key: string;
  row: SearchRow;
  source: RowSource;
  listing?: ListingChoice | undefined;
};

/** What a choice opens: the instrument's page (addressed by the row's
 * subject, its representative listing) on one of its listings. */
export type SearchChoice = { subject: string; listing: string };

/** A row opens its representative (preferred) listing; a side-list line
 * opens the same instrument on the listing it names. */
export function choiceOf(option: SearchOption): SearchChoice {
  return {
    subject: option.row.id,
    listing: option.listing?.id ?? option.row.id,
  };
}

export function listingOptions(
  row: SearchRow,
  listings: readonly ListingChoice[],
): SearchOption[] {
  return listings.map((listing) => ({
    key: `listing:${listing.id}`,
    row,
    source: "listing",
    listing,
  }));
}

export function searchOptions(
  rows: readonly SearchRow[],
  source: RowSource,
): SearchOption[] {
  return rows.map((row) => ({ key: `${source}:${row.id}`, row, source }));
}
