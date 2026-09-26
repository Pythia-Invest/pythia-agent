import type { InstrumentKind, SearchGroup, SearchRow } from "../search";

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

export type RowSource = "directory" | "lookup";

/** One selectable row in panel order. A group's first row leads it with the
 * security's name and type; its other listings follow as compact rows. */
export type SearchOption = {
  key: string;
  row: SearchRow;
  group: SearchGroup;
  lead: boolean;
  source: RowSource;
};

export function searchOptions(
  groups: readonly SearchGroup[],
  source: RowSource,
): SearchOption[] {
  return groups.flatMap((group) =>
    group.rows.map((row, index) => ({
      key: `${source}:${row.id}`,
      row,
      group,
      lead: index === 0,
      source,
    })),
  );
}

/** The highlighted option is remembered by key; an unknown key falls back to
 * the first option, so Enter always acts on what is highlighted. */
export function activeOption(
  options: readonly SearchOption[],
  key: string | null,
): SearchOption | undefined {
  return options.find((option) => option.key === key) ?? options[0];
}

/** Arrow keys move the highlight through every row and wrap at the ends. */
export function moveActive(
  options: readonly SearchOption[],
  key: string | null,
  offset: 1 | -1,
): string | undefined {
  const current = activeOption(options, key);
  if (!current) return undefined;
  const index = options.indexOf(current) + offset;
  return options[(index + options.length) % options.length]?.key;
}
