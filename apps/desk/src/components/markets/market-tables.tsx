"use client";
import type { MoverList } from "@pythia/market-data/markets";
import {
  type InstrumentDisplay,
  type InstrumentRead,
  InstrumentTable,
} from "@pythia/ui";
import { ArrowUpRight, Unlink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useLocalTime } from "@/client/local-time";
import { useMarketMovers } from "@/client/market-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import type { SubjectDay } from "./market-card";
import { moverItem } from "./market-subjects";

const MOVERS_ROWS = 10;

/** One titled block of a card, titled in small secondary type. */
export function Block({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-2.5 flex items-baseline justify-between gap-2 font-medium text-[11px] text-foreground-secondary">
        {title}
        {meta ? (
          <span className="min-w-0 truncate font-normal text-[10px]">
            {meta}
          </span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

/** Where a row leads: its instrument page, or null with the reason. */
type RowLink = { href: string | null; name: string; note?: string | undefined };

/** A table whose rows are links to their instrument page: each row's open
 * link covers the row, and the row's status controls sit above it. A row
 * without a page shows why instead. */
function LinkedTable({
  read,
  path,
  links,
}: {
  read: InstrumentRead;
  path: boolean;
  links: Map<string, RowLink>;
}) {
  return (
    <div className="[&_[data-slot=instrument-row]:has(a):hover]:bg-interaction-hover [&_[data-slot=instrument-row]]:relative [&_button]:relative [&_button]:z-10">
      <InstrumentTable
        read={read}
        options={{ name: true, path }}
        action={(item: InstrumentDisplay) => {
          const target = links.get(item.id);
          if (!target) return null;
          if (target.href)
            return (
              <Link
                href={target.href}
                aria-label={`Open ${target.name}`}
                className="grid size-6 place-items-center rounded-sm text-foreground-secondary outline-ring after:absolute after:inset-0 hover:text-foreground focus-visible:outline-2"
              >
                <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            );
          return (
            <span
              role="img"
              aria-label={target.note}
              title={target.note}
              className="grid size-6 place-items-center text-foreground-secondary"
            >
              <Unlink aria-hidden="true" className="size-3.5" />
            </span>
          );
        }}
      />
    </div>
  );
}

/** One ranked list: rows as the source supplies them, each opening its
 * Pythia instrument; a row the reference cannot place stays, marked and
 * without a link. */
export function MoversTable({
  list,
  title,
}: {
  list: MoverList;
  title: string;
}) {
  const query = useMarketMovers(list, MOVERS_ROWS);
  const time = useLocalTime();
  const movers = query.data?.movers;
  const source = movers?.source?.source ?? "";
  const links = new Map<string, RowLink>();
  const rows = (movers?.rows ?? []).map((row) => {
    const item = moverItem(row, source, time(row.time, "compact"));
    links.set(item.id, {
      href: row.subject_id ? instrumentHref(row.subject_id) : null,
      name: row.name ?? row.symbol,
      note: row.unresolved ?? undefined,
    });
    return item;
  });
  const failure = query.error
    ? query.error.message || "This list could not be read."
    : query.data && query.data.outcome !== "ok"
      ? (query.data.issues[0]?.message ?? "This list is empty.")
      : undefined;
  const read: InstrumentRead = query.isPending
    ? { state: "loading", rows: [] }
    : rows.length
      ? { state: "ready", rows }
      : {
          state: query.data?.outcome === "empty" ? "empty" : "error",
          rows: [],
          message: failure,
        };
  return (
    <Block title={title}>
      <LinkedTable read={read} path={false} links={links} />
    </Block>
  );
}

/** What the lists rank, their source and the time of their quotes, from the
 * first list's read (the tables share one source). */
export function MoversCaption() {
  const query = useMarketMovers("most_active", MOVERS_ROWS);
  const time = useLocalTime();
  const movers = query.data?.movers;
  if (!movers?.source) return null;
  const asOf = movers.rows[0]?.time;
  return (
    <p className="-mt-1 mb-3 text-[11px] text-foreground-secondary">
      {[
        movers.universe ?? movers.market,
        movers.source.source,
        asOf ? `quotes as of ${time(asOf, "compact")}` : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/** The configured subjects with prices and today's path, each through the
 * quote source core chose for it. */
export function WatchlistTable({ days }: { days: SubjectDay[] }) {
  const links = new Map<string, RowLink>(
    days.map((day) => [
      day.subject,
      {
        href: day.known ? instrumentHref(day.subject) : null,
        name: day.label?.name ?? day.name,
        note: day.item.statusLabel,
      },
    ]),
  );
  const rows = days.map((day) => day.item);
  // The quotes answer together: known identities wait as placeholders.
  const loading = days.some((day) => day.loading);
  const read: InstrumentRead = !days.length
    ? {
        state: "empty",
        rows: [],
        message:
          "Add subject IDs to markets_watchlist in settings.json to follow them here.",
      }
    : { state: loading ? "loading" : "ready", rows };
  return <LinkedTable read={read} path links={links} />;
}
