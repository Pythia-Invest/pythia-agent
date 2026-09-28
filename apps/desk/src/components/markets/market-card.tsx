"use client";
import { dayBinding } from "@pythia/market-data/widgets";
import { cn, InstrumentTile } from "@pythia/ui";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useSubjectPages } from "@/client/market-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useBindingSnapshot } from "@/components/widgets/bound-widget";
import { subjectLabel, subjectQuote, unavailableItem } from "./market-subjects";

const TILE = { name: true, change: "both" } as const;

/** A click anywhere on a card or table row opens the page its own link
 * names; its controls (status explanations, the link) keep their clicks. The
 * link is the keyboard path. */
export function openByLink(push: (href: string) => void) {
  return (event: MouseEvent) => {
    const target = event.target as Element;
    if (target.closest("a, button")) return;
    const href = target
      .closest("[data-slot=market-card], [data-slot=instrument-row]")
      ?.querySelector("[data-slot=market-open]")
      ?.getAttribute("href");
    if (href) push(href);
  };
}

/** A quote time short enough for a card: the time today, else the weekday
 * too, in the viewer's zone; the tile's status explains the full time. */
function shortTime(value: string) {
  const date = new Date(value);
  const today = date.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, {
    ...(today ? {} : { weekday: "short" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Each subject's display: its page composition, core's quote source and one
 * shared quote-and-path read for all of them. Reads start once every
 * composition has answered, so they join the update channel together. */
export function useSubjectDays(subjects: readonly string[]) {
  const pages = useSubjectPages(subjects);
  const settled = pages.every((page) => !page.isPending);
  const quotes = pages.map((page) =>
    page.data ? subjectQuote(page.data) : undefined,
  );
  const rows = settled
    ? quotes.flatMap((quote) => (quote?.row ? [quote.row] : []))
    : [];
  const { snapshot } = useBindingSnapshot(dayBinding, { rows });
  let next = 0;
  return subjects.map((subject, index) => {
    const page = pages[index];
    const quote = quotes[index];
    const label = page?.data ? subjectLabel(page.data) : undefined;
    const at = quote?.row && settled ? next++ : -1;
    const item =
      at >= 0 && snapshot?.data.rows[at]
        ? { ...snapshot.data.rows[at], id: subject }
        : unavailableItem(
            subject,
            label?.symbol ?? subject,
            label?.name,
            page?.error
              ? page.error.message || "This subject could not be read."
              : (quote?.reason ?? "Loading"),
          );
    return {
      subject,
      item,
      label,
      source: quote?.row ? quote.source : undefined,
      asOf: at >= 0 ? (snapshot?.data.times[at] ?? null) : null,
      loading: Boolean(
        page?.isPending ||
          (quote?.row && (at < 0 || snapshot?.data.pending[at] !== false)),
      ),
      known: Boolean(page?.data),
    };
  });
}

export type SubjectDay = ReturnType<typeof useSubjectDays>[number];

/**
 * One market at a glance: its name, last value, change, today's path, market
 * and data state, and the source core chose for the instrument page's quote.
 * Clicking the card opens that page. A subject no source can serve still
 * shows, with the reason.
 */
export function DayCard({ day }: { day: SubjectDay }) {
  const router = useRouter();
  return (
    <Frame
      href={instrumentHref(day.subject)}
      name={day.label?.symbol ?? day.subject}
      onClick={openByLink(router.push)}
      footer={
        day.source ? (
          <>
            {day.source}
            {day.asOf ? ` · ${shortTime(day.asOf)}` : ""}
          </>
        ) : day.known ? (
          <span className="text-warning">{day.item.statusLabel}</span>
        ) : (
          "Loading…"
        )
      }
    >
      <InstrumentTile
        item={day.item}
        options={TILE}
        loading={day.loading}
        className="border-0 bg-transparent p-0"
      />
    </Frame>
  );
}

/** One market card from its subject ID alone. */
export function MarketCard({ subject }: { subject: string }) {
  const [day] = useSubjectDays([subject]);
  return day ? <DayCard day={day} /> : null;
}

function Frame({
  href,
  name,
  onClick,
  footer,
  children,
}: {
  href: string;
  name: string;
  onClick: (event: MouseEvent) => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the card's link is the keyboard path
    <article
      data-slot="market-card"
      aria-label={name}
      onClick={onClick}
      className={cn(
        "flex w-44 max-w-full shrink-0 cursor-pointer flex-col gap-1 rounded-control border border-border/55 bg-raised px-2.5 pt-2 pb-1",
        "motion-fast transition-colors hover:border-border-strong",
      )}
    >
      {children}
      <footer className="flex min-h-5 items-center justify-between gap-2 text-[10px] text-foreground-secondary">
        <span className="min-w-0 truncate">{footer}</span>
        <Link
          href={href}
          data-slot="market-open"
          aria-label={`Open ${name}`}
          className="-mr-1 grid size-5 shrink-0 place-items-center rounded-sm outline-ring hover:text-foreground focus-visible:outline-2"
        >
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Link>
      </footer>
    </article>
  );
}
