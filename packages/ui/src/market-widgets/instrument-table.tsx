import type { ReactNode } from "react";
import { cn } from "../class-name";
import { Skeleton } from "../feedback/skeleton";
import type {
  InstrumentDisplay,
  InstrumentRead,
  InstrumentWidgetOptions,
} from "./types";
import {
  InstrumentIdentity,
  InstrumentChange,
  InstrumentPrice,
} from "./values";
import { InstrumentPathView } from "./instrument-path";
import {
  InstrumentExtendedSummary,
  extendedDescription,
} from "./extended-change";

/** Headerless semantic table: identity, optional history, price/change. Shared
 * quote/session/chart primitives preserve tile semantics. Known rows retain their
 * geometry while loading; only history pulses. No selection or provider fetching.
 * Status controls retain keyboard/touch targets in the dense, theme-neutral rows. */
export function InstrumentTable({
  read,
  options = {},
  action,
  className,
}: {
  read: InstrumentRead;
  options?: InstrumentWidgetOptions | undefined;
  action?: (item: InstrumentDisplay) => ReactNode;
  className?: string;
}) {
  if (read.state === "error" || read.state === "empty")
    return (
      <div
        data-slot="instrument-table"
        className={cn("w-88 min-w-0 max-w-full", className)}
      >
        <InstrumentReadState read={read} />
      </div>
    );
  const loading = read.state === "loading";
  const placeholderRows = loading && !read.rows.length;
  const rows = placeholderRows ? loadingRows : read.rows;
  return (
    <div
      data-slot="instrument-table"
      aria-busy={loading || undefined}
      className={cn(
        "@container w-88 min-w-0 max-w-full rounded-control border border-border bg-raised px-2.5",
        className,
      )}
    >
      <table className="w-full table-fixed border-collapse text-xs">
        <colgroup>
          <col />
          {options.path !== false && <col className="@min-[300px]:w-16 w-12" />}
          <col
            className={
              options.change === "both" ? "@min-[300px]:w-28 w-20" : "w-20"
            }
          />
          {action && <col className="w-8" />}
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Instrument</th>
            {options.path !== false && <th scope="col">Price history</th>}
            <th scope="col">Price and change</th>
            {action && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              data-slot="instrument-row"
              className="border-border/55 border-b last:border-b-0"
            >
              <th
                scope="row"
                className="min-w-0 py-2 pr-2 text-left font-normal"
              >
                <InstrumentIdentity
                  item={item}
                  options={{ ...options, compact: false }}
                  loading={loading}
                  detail={extendedDescription(item)}
                  layout="table"
                />
              </th>
              {options.path !== false && (
                <td className="px-1 py-1">
                  <InstrumentPathView
                    item={item}
                    loading={loading}
                    height={options.pathHeight ?? 28}
                  />
                </td>
              )}
              <td className="relative py-1 text-right align-middle">
                <div
                  className={cn(
                    "flex min-h-7 flex-col justify-center leading-3.5",
                    loading && "invisible",
                  )}
                  aria-hidden={loading || undefined}
                >
                  <div>
                    <InstrumentPrice item={item} />
                  </div>
                  <InstrumentChange item={item} mode={options.change} wrap />
                  {item.extended && (
                    <div>
                      <InstrumentExtendedSummary item={item} />
                    </div>
                  )}
                </div>
                {loading && (
                  <div
                    className="absolute inset-0 flex flex-col items-end justify-center gap-1.5"
                    aria-hidden="true"
                  >
                    <Skeleton className="w-14 after:hidden" />
                    <Skeleton className="w-12 after:hidden" />
                  </div>
                )}
              </td>
              {action && (
                <td className="pl-1">{!placeholderRows && action(item)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {read.message && (
        <p role="status" className="py-2 text-foreground-secondary text-xs">
          {read.message}
        </p>
      )}
    </div>
  );
}
const loadingRows: InstrumentDisplay[] = [0, 1, 2].map((index) => ({
  id: `loading-${index}`,
  ticker: "",
  price: null,
  status: "unknown",
  statusLabel: "Loading quote",
  description: "Loading instrument",
}));

/** Loading, empty and failed list presentation with a textual status in both
 * themes. Loading uses the table's reserved geometry; the caller owns the
 * failure explanation and renders ready lists with InstrumentTable. */
export function InstrumentReadState({ read }: { read: InstrumentRead }) {
  if (read.state === "loading") return <InstrumentTable read={read} />;
  return (
    <div
      data-slot="instrument-read-state"
      role="status"
      className="min-w-0 rounded-control border border-border border-dashed bg-subtle px-4 py-5 text-center text-foreground-secondary text-xs"
    >
      <p className="font-semibold text-foreground">
        {read.state === "error"
          ? "Data unavailable"
          : "Nothing on this list yet"}
      </p>
      <p className="mt-1">
        {read.message ?? "Add instruments to see their prices and changes."}
      </p>
    </div>
  );
}
