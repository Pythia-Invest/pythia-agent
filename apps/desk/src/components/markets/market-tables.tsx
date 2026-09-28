"use client";
import type { MoverList } from "@pythia/market-data/markets";
import { dayBinding } from "@pythia/market-data/widgets";
import {
  type InstrumentDisplay,
  type InstrumentRead,
  InstrumentTable,
} from "@pythia/ui";
import { ArrowUpRight, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useLocalTime } from "@/client/local-time";
import { useMarketMovers, useSubjectPages } from "@/client/market-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useBindingSnapshot } from "@/components/widgets/bound-widget";
import { openByLink } from "./market-card";
import {
  moverItem,
  subjectLabel,
  subjectQuote,
  unavailableItem,
} from "./market-subjects";

const MOVERS_ROWS = 10;

/** Where a row leads: its instrument page, or null with the reason. */
type RowLink = { href: string | null; name: string; note?: string | undefined };

/** A row's end: a link to its page, or why it has none. */
function OpenLink({ href, name }: { href: string | null; name: string }) {
  return href ? (
    <Link
      href={href}
      data-slot="market-open"
      aria-label={`Open ${name}`}
      className="grid size-6 place-items-center rounded-sm text-foreground-secondary outline-ring hover:text-foreground focus-visible:outline-2"
    >
      <ArrowUpRight aria-hidden="true" className="size-3.5" />
    </Link>
  ) : null;
}

/** A table whose rows open their instrument page on click. */
function LinkedTable({
  read,
  path,
  links,
}: {
  read: InstrumentRead;
  path: boolean;
  links: Map<string, RowLink>;
}) {
  const router = useRouter();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; each row's link is the keyboard path
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above
    <div
      className="[&_[data-slot=instrument-row]:hover]:bg-interaction-hover [&_[data-slot=instrument-row]]:cursor-pointer"
      onClick={openByLink(router.push)}
    >
      <InstrumentTable
        read={read}
        options={{ name: true, change: "both", path }}
        className="w-full"
        action={(item: InstrumentDisplay) => {
          const target = links.get(item.id);
          if (!target) return null;
          if (target.href)
            return <OpenLink href={target.href} name={target.name} />;
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

function Panel({
  title,
  meta,
  notice,
  children,
}: {
  title: string;
  meta?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="market-table"
      aria-label={title}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-foreground text-xs">{title}</h3>
        <span className="min-w-0 truncate text-[10px] text-foreground-secondary">
          {meta}
        </span>
      </header>
      {children}
      {notice ? (
        <p role="status" className="text-[11px] text-warning">
          {notice}
        </p>
      ) : null}
    </section>
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
  const drift = query.data?.issues.find(
    (issue) => issue.code === "source_drift",
  );
  const asOf = movers?.rows[0]?.time;
  return (
    <Panel
      title={title}
      meta={
        movers?.source
          ? [movers.market, source, asOf ? time(asOf, "compact") : null]
              .filter(Boolean)
              .join(" · ")
          : null
      }
      notice={drift?.message}
    >
      <LinkedTable read={read} path={false} links={links} />
    </Panel>
  );
}

/** The configured subjects with prices and today's path, each through the
 * quote source core chose for it. */
export function WatchlistTable({ subjects }: { subjects: readonly string[] }) {
  const pages = useSubjectPages(subjects);
  const quotes = pages.map((page) =>
    page.data ? subjectQuote(page.data) : undefined,
  );
  const priced = quotes.flatMap((quote) => (quote?.row ? [quote.row] : []));
  const { snapshot } = useBindingSnapshot(dayBinding, { rows: priced });
  const links = new Map<string, RowLink>();
  let next = 0;
  const rows = subjects.map((subject, index) => {
    const page = pages[index];
    const quote = quotes[index];
    const label = page?.data ? subjectLabel(page.data) : undefined;
    const item: InstrumentDisplay =
      quote?.row && snapshot?.data.rows[next]
        ? { ...(snapshot.data.rows[next++] as InstrumentDisplay), id: subject }
        : unavailableItem(
            subject,
            label?.symbol ?? subject,
            label?.name,
            page?.error
              ? page.error.message || "This subject could not be read."
              : (quote?.reason ?? "Loading"),
          );
    links.set(subject, {
      href: page?.data ? instrumentHref(subject) : null,
      name: label?.name ?? label?.symbol ?? subject,
      note: item.statusLabel,
    });
    return item;
  });
  const loading = pages.some((page) => page.isPending);
  const read: InstrumentRead = !subjects.length
    ? {
        state: "empty",
        rows: [],
        message:
          "Add subject IDs to markets_watchlist in settings.json to follow them here.",
      }
    : loading && !pages.some((page) => page.data)
      ? { state: "loading", rows: [] }
      : { state: "ready", rows };
  return <LinkedTable read={read} path links={links} />;
}
