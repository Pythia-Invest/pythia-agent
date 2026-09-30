import type { InstrumentKind, SearchGroup, SearchRow } from "../search";

export type TypeFilter = "all" | "stocks" | "etfs" | "crypto" | "funds";

/** Type pills in display order, with the instrument kinds each one asks the
 * directory for. Only kinds search can return have a pill: indexes, currency
 * pairs and bonds are not in the directory yet
 * (docs/architecture/markets-overview.md, Limits). */
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
  // A pool or protocol a DeFi plugin introduced is found under Crypto too.
  {
    value: "crypto",
    label: "Crypto",
    kinds: ["coin", "token", "market", "protocol"],
  },
  { value: "funds", label: "Funds", kinds: ["fund"] },
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
  market: "Market",
  protocol: "Protocol",
};

/** The plain type a result row shows; a receipt on its own reads as a stock. */
export const ROW_LABELS: Record<InstrumentKind, string> = {
  ...KIND_LABELS,
  preferred: "Preferred",
  depositary_receipt: "Stock",
  token: "Crypto",
};

/** One selectable entry in panel order: a listing row of a group, or the
 * group's toggle between its relevant listings and all of them. */
export type SearchOption = {
  key: string;
  group: SearchGroup;
  /** The listing a choice opens; absent on the toggle. */
  row?: SearchRow | undefined;
};

/** Each group's relevant listings (all of them when expanded and read),
 * then its toggle when it has more listings than the search answer carries.
 * `full` holds the group reads of expanded groups, by group id. */
export function searchOptions(
  groups: readonly SearchGroup[],
  expanded: ReadonlySet<string> = new Set(),
  full: ReadonlyMap<string, readonly SearchRow[]> = new Map(),
): SearchOption[] {
  return groups.flatMap((group) => {
    // Expanded, the relevant rows stay first and the rest follow in core's
    // order, so nothing already shown moves.
    const all = expanded.has(group.id) ? full.get(group.id) : undefined;
    const shown = new Set(group.rows.map((row) => row.id));
    const rows = all
      ? [...group.rows, ...all.filter((row) => !shown.has(row.id))]
      : group.rows;
    const options: SearchOption[] = rows.map((row) => ({
      key: `${group.id}:${row.id}`,
      group,
      row,
    }));
    if (group.listings > group.rows.length)
      options.push({ key: `${group.id}:toggle`, group });
    return options;
  });
}
