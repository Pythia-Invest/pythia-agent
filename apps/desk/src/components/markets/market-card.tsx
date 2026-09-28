"use client";
import { dayBinding } from "@pythia/market-data/widgets";
import { cn, InstrumentTile } from "@pythia/ui";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useLocalTime } from "@/client/local-time";
import { useSubjectPage } from "@/client/instrument-queries";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useBindingSnapshot } from "@/components/widgets/bound-widget";
import { subjectLabel, subjectQuote, unavailableItem } from "./market-subjects";

const TILE = { name: true, change: "both", pathHeight: 36 } as const;

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

/**
 * One market at a glance from a subject ID alone: its name, last value,
 * change, today's path, market and data state, and the source core chose for
 * the instrument page's quote. Clicking opens that page. A subject no source
 * can serve still shows, with the reason.
 */
export function MarketCard({ subject }: { subject: string }) {
  const page = useSubjectPage(subject);
  const quote = page.data ? subjectQuote(page.data) : undefined;
  const { snapshot } = useBindingSnapshot(dayBinding, {
    rows: quote?.row ? [quote.row] : [],
  });
  const time = useLocalTime();
  const router = useRouter();
  const href = instrumentHref(subject);
  const label = page.data ? subjectLabel(page.data) : undefined;
  const item =
    quote?.row && snapshot?.data.rows[0]
      ? snapshot.data.rows[0]
      : unavailableItem(
          subject,
          label?.symbol ?? subject,
          label?.name,
          page.error
            ? page.error.message || "This subject could not be read."
            : (quote?.reason ?? "Loading"),
        );
  const asOf = snapshot?.data.times[0];
  return (
    <Frame
      href={href}
      name={label?.symbol ?? subject}
      onClick={openByLink(router.push)}
      footer={
        page.isPending ? (
          "Loading…"
        ) : quote?.row ? (
          <>
            {quote.source}
            {asOf ? ` · ${time(asOf, "compact")}` : ""}
          </>
        ) : (
          <span className="text-warning">{item.statusLabel}</span>
        )
      }
    >
      <InstrumentTile
        item={item}
        options={TILE}
        loading={page.isPending || snapshot?.state === "loading"}
        className="border-0 bg-transparent p-0"
      />
    </Frame>
  );
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
        "flex min-w-0 cursor-pointer flex-col gap-1 rounded-control border border-border/60 bg-raised px-2.5 pt-2 pb-1.5",
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
