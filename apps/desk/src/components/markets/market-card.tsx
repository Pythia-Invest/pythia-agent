"use client";
import { dayBinding } from "@pythia/market-data/widgets";
import { InstrumentTile } from "@pythia/ui";
import Link from "next/link";
import { useSubjectPages } from "@/client/market-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useBindingSnapshot } from "@/components/widgets/bound-widget";
import {
  loadingItem,
  subjectLabel,
  subjectQuote,
  unavailableItem,
} from "./market-subjects";

const TILE = { name: true, change: "both" } as const;

/** Each subject's display: its page composition, core's quote source and one
 * shared quote-and-path read for all of them. Reads start once every
 * composition has answered, so they join the update channel together.
 * `message` and `retry` cover the reads of every subject; each day says
 * whether its own read failed. */
export function useSubjectDays(subjects: readonly string[]) {
  const pages = useSubjectPages(subjects);
  const settled = pages.every((page) => !page.isPending);
  const quotes = pages.map((page) =>
    page.data ? subjectQuote(page.data) : undefined,
  );
  const rows = settled
    ? quotes.flatMap((quote) => (quote?.row ? [quote.row] : []))
    : [];
  const { snapshot, retry } = useBindingSnapshot(dayBinding, { rows });
  let next = 0;
  const days = subjects.map((subject, index) => {
    const page = pages[index];
    const quote = quotes[index];
    const label = page?.data ? subjectLabel(page.data) : undefined;
    const at = quote?.row && settled ? next++ : -1;
    const row = at >= 0 ? snapshot?.data.rows[at] : undefined;
    const item = row
      ? { ...row, id: subject }
      : page?.error
        ? unavailableItem(
            subject,
            subject,
            undefined,
            page.error.message || "This subject could not be read.",
          )
        : quote?.reason
          ? unavailableItem(
              subject,
              label?.symbol ?? subject,
              label?.name,
              quote.reason,
            )
          : loadingItem(subject, label?.symbol ?? "", label?.name);
    return {
      subject,
      item,
      label,
      source: quote?.row ? quote.source : undefined,
      loading: Boolean(
        page?.isPending ||
          (quote?.row && (at < 0 || snapshot?.data.pending[at] !== false)),
      ),
      failed: Boolean(page?.error || (at >= 0 && snapshot?.data.failed[at])),
      known: Boolean(page?.data),
    };
  });
  return {
    days,
    message: snapshot?.message,
    retry: () => {
      retry();
      for (const page of pages) if (page.error) void page.refetch();
    },
  };
}

export type SubjectDay = ReturnType<typeof useSubjectDays>["days"][number];

/**
 * One market at a glance, the September tile itself: its name, last value,
 * change, today's path, and market and data state (the status explains the
 * quote time and source). The tile is a link to the instrument page; its
 * status controls sit above the link and keep their clicks. A subject no
 * source can serve still shows, with the reason.
 */
export function MarketCard({ day }: { day: SubjectDay }) {
  return (
    <div
      data-slot="market-card"
      className="relative @min-[520px]:w-44 w-full min-w-0 max-w-full shrink-0 [&_button]:relative [&_button]:z-10"
    >
      <InstrumentTile
        item={day.item}
        options={TILE}
        loading={day.loading}
        className="w-full border-border/55"
      />
      {day.known ? (
        <Link
          href={instrumentHref(day.subject)}
          aria-label={`Open ${day.label?.symbol ?? day.subject}`}
          className="absolute inset-0 rounded-control outline-ring focus-visible:outline-2"
        />
      ) : null}
    </div>
  );
}
