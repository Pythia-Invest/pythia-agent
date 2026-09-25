import type { RowKind, SearchResponse, SearchRow } from "../search";

export type TypeFilter = "all" | RowKind;
export type RowSource = "directory" | "lookup";

/** Type pills in display order. Filtering never re-ranks the returned rows. */
export const TYPE_FILTERS: readonly { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "equity", label: "Stocks" },
  { value: "etf", label: "ETFs" },
  { value: "crypto", label: "Crypto" },
  { value: "fund", label: "Funds" },
  { value: "index", label: "Indices" },
  { value: "fx", label: "Currencies" },
  { value: "bond", label: "Bonds" },
];

export const KIND_LABELS: Record<RowKind, string> = {
  equity: "Stock",
  etf: "ETF",
  fund: "Fund",
  bond: "Bond",
  index: "Index",
  fx: "Currency",
  crypto: "Crypto",
};

/** Listings of one security: the primary listing is shown, others expand. */
export type SearchGroup = {
  key: string;
  primary: SearchRow;
  others: SearchRow[];
};

/** Groups ranked rows without inferring identity from names or tickers. A server
 * grouping wins; otherwise rows sharing `security_id` form one group. Groups keep
 * the rank of their best row. */
export function groupResults(
  response: Pick<SearchResponse, "results" | "groups">,
  filter: TypeFilter,
): SearchGroup[] {
  const hinted = new Map<string, { key: string; position: number }>();
  for (const group of response.groups ?? [])
    group.row_ids.forEach((id, position) => {
      if (!hinted.has(id))
        hinted.set(id, { key: `group:${group.key}`, position });
    });
  const seen = new Set<string>();
  const members = new Map<string, SearchRow[]>();
  for (const row of response.results) {
    if (seen.has(row.row_id) || (filter !== "all" && row.kind !== filter))
      continue;
    seen.add(row.row_id);
    const key =
      hinted.get(row.row_id)?.key ??
      (row.security_id ? `security:${row.security_id}` : `row:${row.row_id}`);
    const list = members.get(key);
    if (list) list.push(row);
    else members.set(key, [row]);
  }
  return [...members].flatMap(([key, rows]) => {
    const server = key.startsWith("group:");
    const ordered = server
      ? rows.toSorted(
          (a, b) =>
            (hinted.get(a.row_id)?.position ?? 0) -
            (hinted.get(b.row_id)?.position ?? 0),
        )
      : rows;
    const primary = server
      ? ordered[0]
      : (ordered.find((row) => row.is_primary) ?? ordered[0]);
    return primary
      ? [{ key, primary, others: ordered.filter((row) => row !== primary) }]
      : [];
  });
}

export type SearchItem =
  | {
      type: "row";
      key: string;
      row: SearchRow;
      group: string;
      nested: boolean;
      source: RowSource;
    }
  | {
      type: "toggle";
      key: string;
      group: string;
      expanded: boolean;
      others: SearchRow[];
    };

/** The flat, keyboard-navigable order of everything the panel lists. */
export function searchItems(
  groups: readonly SearchGroup[],
  expanded: ReadonlySet<string>,
  lookupRows: readonly SearchRow[] = [],
): SearchItem[] {
  const items: SearchItem[] = [];
  for (const group of groups) {
    items.push(rowItem(group.primary, group.key, false, "directory"));
    if (!group.others.length) continue;
    const open = expanded.has(group.key);
    items.push({
      type: "toggle",
      key: `toggle:${group.key}`,
      group: group.key,
      expanded: open,
      others: group.others,
    });
    if (open)
      for (const row of group.others)
        items.push(rowItem(row, group.key, true, "directory"));
  }
  for (const row of lookupRows)
    items.push(rowItem(row, `lookup:${row.row_id}`, false, "lookup"));
  return items;
}

function rowItem(
  row: SearchRow,
  group: string,
  nested: boolean,
  source: RowSource,
): SearchItem {
  return {
    type: "row",
    key: `${source}:${row.row_id}`,
    row,
    group,
    nested,
    source,
  };
}

/** The active option is remembered by key; a missing key falls back to the
 * first item, so Enter always acts on what is highlighted. */
export function activeItem(
  items: readonly SearchItem[],
  activeKey: string | null,
): SearchItem | undefined {
  return items.find((item) => item.key === activeKey) ?? items[0];
}

export type NavigationKey =
  | "ArrowDown"
  | "ArrowUp"
  | "ArrowRight"
  | "ArrowLeft"
  | "Enter";

export type NavigationIntent =
  | { type: "activate"; key: string }
  | { type: "select"; row: SearchRow; source: RowSource }
  | { type: "expand"; group: string; expanded: boolean; activate: string }
  | { type: "none" };

/** Combobox keyboard model: focus stays in the input while the highlighted
 * option moves. Right expands a security's other listings, Left collapses. */
export function navigate(
  items: readonly SearchItem[],
  activeKey: string | null,
  key: NavigationKey,
): NavigationIntent {
  const current = activeItem(items, activeKey);
  if (!current) return { type: "none" };
  const index = items.indexOf(current);
  const toggle = items.find(
    (item) => item.type === "toggle" && item.group === current.group,
  );
  const step = (offset: number): NavigationIntent => {
    const next = items[(index + offset + items.length) % items.length];
    return next ? { type: "activate", key: next.key } : { type: "none" };
  };
  switch (key) {
    case "ArrowDown":
      return step(1);
    case "ArrowUp":
      return step(-1);
    case "Enter":
      return current.type === "row"
        ? { type: "select", row: current.row, source: current.source }
        : {
            type: "expand",
            group: current.group,
            expanded: !current.expanded,
            activate: current.key,
          };
    case "ArrowRight":
      return toggle?.type === "toggle" && !toggle.expanded
        ? {
            type: "expand",
            group: current.group,
            expanded: true,
            activate: current.key,
          }
        : { type: "none" };
    case "ArrowLeft": {
      if (toggle?.type !== "toggle" || !toggle.expanded)
        return { type: "none" };
      // A collapsed listing disappears; keep the highlight on its security.
      const primary = items.find(
        (item) => item.type === "row" && item.group === current.group,
      );
      return {
        type: "expand",
        group: current.group,
        expanded: false,
        activate:
          current.type === "row" && current.nested && primary
            ? primary.key
            : current.key,
      };
    }
  }
}
