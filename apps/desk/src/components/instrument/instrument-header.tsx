"use client";

import { KIND_LABELS } from "@pythia/market-data/search-ui";
import type { SubjectListing, SubjectPage } from "@pythia/market-data/subject";
import { Menu, Skeleton } from "@pythia/ui";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { instrumentHref } from "./instrument-href";
import { listingGroups, listingLabel, listingVenue } from "./listing-groups";

const IDENTIFIERS = [
  ["isin", "ISIN"],
  ["lei", "LEI"],
  ["cik", "CIK"],
  ["figi", "FIGI"],
  ["caip19", "CAIP-19"],
] as const;
const CRYPTO_KINDS = new Set(["coin", "token"]);

/** The listing whose price the composition shows: its own subject when it
 * is a listing, else the one core priced it through. */
function currentListing(page: SubjectPage): SubjectListing | undefined {
  const priced = page.subject.listing ?? page.subject.id;
  return (
    page.listings.find((listing) => listing.id === priced) ??
    page.listings.find((listing) => listing.primary) ??
    page.listings[0]
  );
}

/** The page is the instrument; `subjectId` is its route subject and `page`
 * its composition, so the kind badge, name and identifiers stay the
 * instrument's while the selector follows the chosen listing. */
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
    const contested = page.contested[key] ?? [];
    return value || contested.length ? [{ key, label, value, contested }] : [];
  });
  const issuer =
    page.issuer && page.issuer.name !== page.subject.name
      ? page.issuer.name
      : null;
  // A share (not a crypto asset) the reference names no issuer for: its
  // issuer is undecided (R2), and its profile and filings wait for it.
  const issuerUnknown =
    !page.issuer &&
    Boolean(page.security) &&
    !CRYPTO_KINDS.has(page.subject.kind ?? "coin");
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
      {/* Core's line of context: a market's, or why a saved instrument opens
          as a stub (no reference data installed). */}
      {page.subject.description ? (
        <p className="text-foreground-secondary text-xs">
          {page.subject.description}
        </p>
      ) : null}
      {issuer ? (
        <p className="text-foreground-secondary text-xs">Issued by {issuer}</p>
      ) : issuerUnknown ? (
        <p className="text-foreground-secondary text-xs">
          Issuer unknown: the reference data doesn't settle which company issued
          this
        </p>
      ) : null}
      <DerivativeLinks page={page} />
      {identifiers.length ? (
        <dl
          data-slot="instrument-identifiers"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
        >
          {identifiers.map(({ key, label, value, contested }) => (
            <div key={key} className="flex min-w-0 max-w-full gap-1.5">
              <dt className="text-foreground-secondary">{label}</dt>
              {contested.length ? (
                <ContestedValues values={contested} />
              ) : (
                <dd
                  title={value ?? undefined}
                  className="truncate font-mono text-foreground tabular-nums"
                >
                  {value}
                </dd>
              )}
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

/** An identifier whose confirm-level sources disagree: core applies neither
 * value, so each is shown with the sources stating it, never a blank. */
function ContestedValues({
  values,
}: {
  values: SubjectPage["contested"][string];
}) {
  return (
    <dd
      data-slot="instrument-identifier-contested"
      className="flex min-w-0 flex-wrap gap-x-1.5"
    >
      {values.map(({ value, sources }) => (
        <span key={value} className="flex min-w-0 gap-1">
          <span
            title={value}
            className="truncate font-mono text-foreground tabular-nums"
          >
            {value}
          </span>
          <span className="text-foreground-secondary">
            ({sources.join(", ")})
          </span>
        </span>
      ))}
      <span className="text-foreground-secondary">sources disagree</span>
    </dd>
  );
}

/** `TICKER · Venue · CCY ▾`: which line of the instrument the price and
 * chart follow. Every line of the instrument as core folds it: the security's
 * own listings, then its depositary receipts. Choosing one keeps the page
 * (profile and filings are the issuer's) and records the listing in the URL. */
function ListingSelector({
  page,
  subjectId,
}: {
  page: SubjectPage;
  subjectId: string;
}) {
  // The URL's listing is the choice at once; the composition that follows
  // it may still be loading.
  const requested = useSearchParams().get("listing");
  const current =
    page.listings.find((listing) => listing.id === requested) ??
    currentListing(page);
  const ids = page.identifiers;
  const label = current
    ? listingLabel(current, page.listings)
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
              {listingGroups(page.listings).map((group, _index, groups) => (
                <Menu.Group key={group.key}>
                  {groups.length > 1 ? (
                    <Menu.GroupLabel>{group.label}</Menu.GroupLabel>
                  ) : null}
                  {group.listings.map((listing) => (
                    <Menu.RadioItem
                      key={listing.id}
                      value={listing.id}
                      closeOnClick
                      data-slot="instrument-listing-option"
                      className="min-h-9 gap-3 py-1.5 text-xs"
                    >
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" />
                      </Menu.RadioItemIndicator>
                      <span className="w-16 flex-none truncate font-semibold text-body">
                        {listing.ticker ?? listing.mic}
                      </span>
                      {/* The venue truncates; the currency, which tells a
                          receipt's lines apart, stays. The group names the
                          kind. */}
                      <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                        {listingVenue(listing, page.listings)}
                      </span>
                      <span className="flex-none text-foreground-secondary">
                        {listing.currency}
                      </span>
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

/** A derivative market's underlying, and on the underlying's page its derivative markets (perps, front-month
 * futures; `derivative_on`, related and never folded): each is its own subject and page. */
function DerivativeLinks({ page }: { page: SubjectPage }) {
  const links = page.related.filter((item) => item.type === "derivative_on");
  if (!links.length) return null;
  return (
    <ul
      aria-label="Related markets"
      data-slot="instrument-related"
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
    >
      {links.map((item) => (
        <li
          key={`${item.direction}:${item.id}`}
          className="flex min-w-0 gap-1.5"
        >
          <span className="text-foreground-secondary">
            {item.direction === "to" ? "Underlying" : "Derivative"}
          </span>
          <Link
            href={instrumentHref(item.id)}
            className="truncate text-foreground underline-offset-2 outline-ring hover:underline focus-visible:outline-2"
          >
            {item.name ?? item.id}
          </Link>
        </li>
      ))}
    </ul>
  );
}
