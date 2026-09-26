"use client";

import { KIND_LABELS } from "@pythia/market-data/search-ui";
import type { SubjectListing, SubjectPage } from "@pythia/market-data/subject";
import { Menu, Skeleton } from "@pythia/ui";
import { Check, ChevronDown } from "lucide-react";
import { instrumentHref } from "./instrument-href";
import { listingGroups, listingLabel } from "./listing-groups";

const IDENTIFIERS = [
  ["isin", "ISIN"],
  ["lei", "LEI"],
  ["cik", "CIK"],
  ["figi", "FIGI"],
  ["caip19", "CAIP-19"],
] as const;

/** The listing whose price the page shows: the composition's own subject
 * when it is a listing, else the primary one. */
export function currentListing(page: SubjectPage): SubjectListing | undefined {
  return (
    page.listings.find((listing) => listing.id === page.subject.id) ??
    page.listings.find((listing) => listing.primary) ??
    page.listings[0]
  );
}

/** The page is the instrument; `subjectId` is its route subject. */
export function InstrumentHeader({
  page,
  subjectId,
}: {
  page: SubjectPage;
  subjectId: string;
}) {
  const ids = page.identifiers;
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
        <ListingSelector page={page} subjectId={subjectId} />
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

/** `TICKER · Venue · CCY ▾`: which line of the instrument the price and
 * chart follow. Every line of the instrument, grouped home market, other
 * exchanges, then OTC and receipts. Choosing one keeps the page (profile and
 * filings are the issuer's) and records the listing in the URL. */
function ListingSelector({
  page,
  subjectId,
}: {
  page: SubjectPage;
  subjectId: string;
}) {
  const current = currentListing(page);
  const ids = page.identifiers;
  const label = current
    ? listingLabel(current)
    : [ids.ticker, ids.mic, ids.currency].filter(Boolean).join(" · ");
  if (!label) return null;
  if (page.listings.length < 2)
    return (
      <span data-slot="instrument-listing" className="text-foreground">
        {label}
      </span>
    );
  return (
    <Menu.Root>
      <Menu.Trigger
        data-slot="instrument-listing"
        aria-label={`Listing: ${label}. Choose another listing`}
        className="motion-fast -mx-1 flex h-7 min-w-0 items-center gap-1 rounded-control px-1.5 font-semibold text-foreground outline-ring transition-colors hover:bg-interaction-hover focus-visible:outline-2 data-popup-open:bg-interaction-active"
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 flex-none stroke-[1.8] text-foreground-secondary"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="bottom">
          <Menu.Popup className="max-h-[min(24rem,var(--available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
            <Menu.RadioGroup
              value={current?.id}
              // Native history updates keep Next's search params in sync
              // without a server round trip or remounting the page.
              onValueChange={(id: string) =>
                window.history.replaceState(
                  null,
                  "",
                  instrumentHref(subjectId, id),
                )
              }
            >
              {listingGroups(page.listings).map((group) => (
                <Menu.Group key={group.key}>
                  <Menu.GroupLabel>{group.label}</Menu.GroupLabel>
                  {group.listings.map((listing) => (
                    <Menu.RadioItem
                      key={listing.id}
                      value={listing.id}
                      data-slot="instrument-listing-option"
                      className="min-h-9 gap-3 py-1.5 text-xs"
                    >
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" />
                      </Menu.RadioItemIndicator>
                      <span className="w-16 flex-none truncate font-semibold text-body">
                        {listing.ticker ?? listing.mic}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                        {[listing.venue ?? listing.mic, listing.currency]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {listing.kind ? (
                        <span className="flex-none text-foreground-secondary">
                          {KIND_LABELS[listing.kind]}
                        </span>
                      ) : null}
                    </Menu.RadioItem>
                  ))}
                </Menu.Group>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
