"use client";

import { KIND_LABELS } from "@pythia/market-data/search-ui";
import type { SubjectListing, SubjectPage } from "@pythia/market-data/subject";
import { cn, Skeleton } from "@pythia/ui";
import Link from "next/link";
import { instrumentHref } from "./instrument-href";

const IDENTIFIERS = [
  ["isin", "ISIN"],
  ["lei", "LEI"],
  ["cik", "CIK"],
  ["figi", "FIGI"],
  ["caip19", "CAIP-19"],
] as const;

function currentListing(page: SubjectPage): SubjectListing | undefined {
  return (
    page.listings.find((listing) => listing.id === page.subject.id) ??
    page.listings.find((listing) => listing.primary)
  );
}

export function InstrumentHeader({ page }: { page: SubjectPage }) {
  const listing = currentListing(page);
  const ids = page.identifiers;
  const ticker = ids.ticker ?? listing?.ticker;
  const place = [
    listing?.venue ?? ids.mic ?? listing?.mic,
    ids.currency ?? listing?.currency,
  ]
    .filter(Boolean)
    .join(" · ");
  const identifiers = IDENTIFIERS.flatMap(([key, label]) => {
    const value =
      ids[key] ??
      (key === "isin" ? page.security?.isin : undefined) ??
      (key === "lei" || key === "cik" ? page.issuer?.[key] : undefined);
    return value ? [{ key, label, value }] : [];
  });
  const issuer =
    page.issuer && page.issuer.name !== page.subject.name
      ? page.issuer.name
      : null;
  return (
    <header data-slot="instrument-header" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-foreground-secondary text-xs">
        {page.subject.kind ? (
          <span className="rounded-pill border border-border bg-subtle px-2 py-0.5 font-semibold">
            {KIND_LABELS[page.subject.kind]}
          </span>
        ) : null}
        {ticker ? (
          <span className="font-semibold text-foreground">{ticker}</span>
        ) : null}
        {place ? <span>{place}</span> : null}
      </div>
      <h1 className="font-semibold text-2xl text-foreground leading-tight tracking-tight">
        {page.subject.name}
      </h1>
      {issuer ? (
        <p className="text-foreground-secondary text-xs">Issued by {issuer}</p>
      ) : null}
      {identifiers.length ? (
        <dl
          data-slot="instrument-identifiers"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
        >
          {identifiers.map(({ key, label, value }) => (
            <div key={key} className="flex min-w-0 max-w-full gap-1.5">
              <dt className="text-foreground-secondary">{label}</dt>
              <dd
                title={value}
                className="truncate font-mono text-foreground tabular-nums"
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {page.queue.length ? (
        <p className="text-foreground-secondary text-xs">
          {page.queue.length === 1
            ? "One identity question is open for the agent to review."
            : `${page.queue.length} identity questions are open for the agent to review.`}
        </p>
      ) : null}
    </header>
  );
}

/** Sibling listings of the security; each is its own page. */
export function ListingSwitcher({ page }: { page: SubjectPage }) {
  if (page.listings.length < 2) return null;
  return (
    <nav
      aria-label="Listings"
      data-slot="instrument-listings"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {page.listings.map((listing) => {
        const current = listing.id === page.subject.id;
        return (
          <Link
            key={listing.id}
            href={instrumentHref(listing.id)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "motion-fast flex h-8 flex-none items-center gap-2 rounded-control border px-2.5 text-xs outline-ring transition-colors focus-visible:outline-2",
              current
                ? "border-border-strong bg-raised text-foreground"
                : "border-border text-foreground-secondary hover:bg-interaction-hover hover:text-foreground",
            )}
          >
            <span className="font-semibold text-foreground">
              {listing.ticker ?? listing.mic ?? "Listing"}
            </span>
            <span>
              {[listing.venue ?? listing.mic, listing.currency]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {listing.primary ? (
              <span className="text-[10px] text-foreground-secondary uppercase tracking-wide">
                Primary
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Reserved geometry while the page composition itself loads. */
export function InstrumentPageSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading instrument"
      data-slot="instrument-page-loading"
      className="@container mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 min-[600px]:px-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="w-40 text-xs" />
        <Skeleton className="h-7 w-72 max-w-full" shape="block" />
        <Skeleton className="w-96 max-w-full text-xs" />
      </div>
      <div className="grid @3xl:grid-cols-3 grid-cols-1 gap-3">
        <Skeleton shape="block" className="@3xl:col-span-2 h-48" />
        <Skeleton shape="block" className="h-48" />
      </div>
    </div>
  );
}
