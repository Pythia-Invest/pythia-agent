"use client";
import { dayBinding } from "@pythia/market-data/widgets";
import { InstrumentTile } from "@pythia/ui";
import { useRouter } from "next/navigation";
import { useSubjectPages } from "@/client/market-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useBindingSnapshot } from "@/components/widgets/bound-widget";
import { subjectLabel, subjectQuote, unavailableItem } from "./market-subjects";

const TILE = { name: true, change: "both" } as const;

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
 * One market at a glance, the September tile itself: its name, last value,
 * change, today's path, and market and data state (the status explains the
 * quote time and source). Clicking or pressing Enter opens the instrument
 * page; the tile's own status controls keep their clicks. A subject no source
 * can serve still shows, with the reason.
 */
export function MarketCard({ day }: { day: SubjectDay }) {
  const router = useRouter();
  const open = () => router.push(instrumentHref(day.subject));
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <a> may not contain the tile's status buttons
    <div
      role="link"
      tabIndex={0}
      data-slot="market-card"
      aria-label={`Open ${day.label?.symbol ?? day.subject}`}
      className="@min-[520px]:w-44 w-full min-w-0 max-w-full shrink-0 cursor-pointer rounded-control outline-ring focus-visible:outline-2"
      onClick={(event) => {
        if (!(event.target as Element).closest("button")) open();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target === event.currentTarget)
          open();
      }}
    >
      <InstrumentTile
        item={day.item}
        options={TILE}
        loading={day.loading}
        className="w-full border-border/55"
      />
    </div>
  );
}
