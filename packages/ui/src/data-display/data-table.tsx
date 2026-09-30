"use client";

import {
  Check,
  ListFilter,
  Minus,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../actions/button";
import { cn } from "../class-name";
import { Input } from "../forms/field";
import { Menu } from "../overlays/menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

/** One column: a header and how a row fills its cell. */
export interface DataTableColumn<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** The full value as text, shown as the cell's tooltip; useful where values may end in an ellipsis. */
  text?: (row: Row) => string;
  /** Width or alignment of this column's cells. Values longer than 18rem are cut off with an ellipsis. */
  className?: string;
}

/** One multi-select filter chip in the toolbar; the owner filters the rows. */
export interface DataTableFilter {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
}

/** One label and value in a row's expanded Context grid. */
export interface DataTableContextItem {
  label: string;
  value: ReactNode;
}

/** Props for the back-office data table. */
export interface DataTableProps<Row> {
  /** Accessible name of the table. */
  label: string;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Names a row in its toggle's label ("Show context for …"). */
  rowLabel?: (row: Row) => string;
  columns: readonly DataTableColumn<Row>[];
  /** Details shown when the row's "+" toggle expands it; omit for no toggle. */
  context?: (row: Row) => readonly DataTableContextItem[];
  /** Actions at the end of each row, such as small buttons opening an ActionDialog. */
  actions?: (row: Row) => ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  filters?: readonly DataTableFilter[];
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Shown in place of rows when there are none (after filtering). */
  empty?: ReactNode;
  /** The key of a row to open on arrival, such as one a link points at: it starts expanded and scrolls into view once it is listed. */
  reveal?: string;
  className?: string;
}

/**
 * Compact back-office table: a toolbar with search, multi-select filter chips
 * and Refresh, then one dense row per record with its most important columns,
 * an action cell at the end, and a "+" toggle that expands a Context grid of
 * labelled details. It filters nothing itself: the owner applies search and
 * filters to `rows`, so data and meaning stay with the application. Native
 * table semantics, a labelled search field, Base UI menus for the chips, and
 * an `aria-expanded` toggle keep it keyboard- and screen-reader-usable in
 * both themes. Do use it for operator lists (issues, tasks, jobs); don't use
 * it for market data or as a spreadsheet.
 */
export function DataTable<Row>({
  label,
  rows,
  rowKey,
  rowLabel,
  columns,
  context,
  actions,
  search,
  filters = [],
  onRefresh,
  refreshing = false,
  empty = "Nothing to show.",
  reveal,
  className,
}: DataTableProps<Row>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(reveal ? [reveal] : []),
  );
  const root = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  // The revealed row may be listed after the first render (its data loads), so
  // this looks again after each render until it has found it.
  useEffect(() => {
    if (!reveal || revealed.current) return;
    const row = [
      ...(root.current?.querySelectorAll("[data-row-key]") ?? []),
    ].find((element) => element.getAttribute("data-row-key") === reveal);
    if (!row) return;
    revealed.current = true;
    row.scrollIntoView?.({ block: "center" });
  });
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const span = columns.length + (context ? 1 : 0) + (actions ? 1 : 0);
  return (
    <div
      ref={root}
      className={cn("flex flex-col gap-3", className)}
      data-slot="data-table"
    >
      {search || filters.length || onRefresh ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-slot="data-table-toolbar"
        >
          {search ? (
            <div className="relative w-full min-[480px]:w-56">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-secondary"
              />
              <Input
                aria-label={search.placeholder}
                className="ps-8"
                onValueChange={search.onChange}
                placeholder={search.placeholder}
                size="sm"
                type="search"
                value={search.value}
              />
            </div>
          ) : null}
          {filters.map((filter) => (
            <FilterChip key={filter.key} filter={filter} />
          ))}
          {onRefresh ? (
            <Button
              className="ms-auto"
              disabled={refreshing}
              onClick={onRefresh}
              size="sm"
              variant="secondary"
            >
              <RefreshCw
                aria-hidden="true"
                className={cn(
                  "size-4",
                  refreshing && "motion-safe:animate-spin",
                )}
              />
              Refresh
            </Button>
          ) : null}
        </div>
      ) : null}
      <Table
        aria-label={label}
        className="text-xs [&_[data-slot=badge]]:min-h-5 [&_[data-slot=badge]]:px-1.5 [&_[data-slot=button]]:h-7 [&_[data-slot=button]]:px-2.5 [&_[data-slot=data-table-row]>td]:h-10 [&_[data-slot=data-table-row]>td]:whitespace-nowrap [&_[data-slot=data-table-row]>td]:py-1 [&_td]:px-2 [&_th]:whitespace-nowrap [&_th]:px-2 [&_th]:py-1.5"
      >
        <TableHeader>
          <TableRow>
            {context ? (
              <TableHead className="w-8" scope="col">
                <span className="sr-only">Details</span>
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={column.className}
                scope="col"
              >
                {column.header}
              </TableHead>
            ))}
            {actions ? (
              <TableHead scope="col">
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="py-6 text-center text-foreground-secondary"
                colSpan={span}
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((row) => {
            const key = rowKey(row);
            const open = expanded.has(key);
            const details = open && context ? context(row) : [];
            return (
              <Fragment key={key}>
                <TableRow
                  data-slot="data-table-row"
                  data-expanded={open || undefined}
                  data-row-key={key}
                >
                  {context ? (
                    <TableCell className="w-8">
                      <button
                        aria-expanded={open}
                        aria-label={`${open ? "Hide" : "Show"} context${rowLabel ? ` for ${rowLabel(row)}` : ""}`}
                        className="grid size-6 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-foreground-secondary outline-ring hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2"
                        onClick={() => toggle(key)}
                        type="button"
                      >
                        {open ? (
                          <Minus aria-hidden="true" className="size-4" />
                        ) : (
                          <Plus aria-hidden="true" className="size-4" />
                        )}
                      </button>
                    </TableCell>
                  ) : null}
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      <div
                        className="max-w-72 truncate"
                        title={column.text?.(row)}
                      >
                        {column.cell(row)}
                      </div>
                    </TableCell>
                  ))}
                  {actions ? (
                    <TableCell className="w-px text-end">
                      <div className="flex flex-nowrap justify-end gap-1">
                        {actions(row)}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
                {open && details.length ? (
                  <TableRow
                    className="bg-subtle hover:bg-subtle"
                    data-slot="data-table-context"
                  >
                    <TableCell colSpan={span} className="py-2">
                      <p className="m-0 mb-1.5 font-semibold text-foreground text-xs">
                        Context
                      </p>
                      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 min-[1100px]:grid-cols-4 min-[720px]:grid-cols-3">
                        {details.map((item) => (
                          <div key={item.label} className="min-w-0">
                            <dt className="text-foreground-secondary text-xs">
                              {item.label}
                            </dt>
                            <dd className="m-0 text-foreground text-xs [overflow-wrap:anywhere]">
                              {item.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FilterChip({ filter }: { filter: DataTableFilter }) {
  const count = filter.selected.length;
  return (
    <Menu.Root>
      <Menu.Trigger
        data-slot="data-table-filter"
        render={
          <Button size="sm" variant="secondary">
            <ListFilter aria-hidden="true" className="size-4" />
            {filter.label}
            {count ? (
              <span className="rounded-pill bg-subtle px-1.5 text-foreground-secondary text-xs tabular-nums">
                <span className="sr-only">, </span>
                {count}
                <span className="sr-only"> selected</span>
              </span>
            ) : null}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            {filter.options.map((option) => {
              const checked = filter.selected.includes(option.value);
              return (
                <Menu.CheckboxItem
                  key={option.value}
                  checked={checked}
                  closeOnClick={false}
                  onCheckedChange={(next) =>
                    filter.onChange(
                      next
                        ? [...filter.selected, option.value]
                        : filter.selected.filter(
                            (value) => value !== option.value,
                          ),
                    )
                  }
                >
                  <Menu.CheckboxItemIndicator>
                    <Check aria-hidden="true" />
                  </Menu.CheckboxItemIndicator>
                  {option.label}
                </Menu.CheckboxItem>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
