"use client";

import { KIND_LABELS } from "@pythia/market-data/search-ui";
import type {
  SubjectListing,
  SubjectPage,
  SubjectSection,
} from "@pythia/market-data/subject";
import { cn, Skeleton } from "@pythia/ui";
import type { MouseEvent, ReactNode } from "react";
import { type PageBlock, pageBlocks } from "./blocks";
import { SectionPlaceholder, SourcesLine } from "./section-status";

export type InstrumentPageProps = {
  page: SubjectPage;
  /** Content of a block whose sections are all ready (and of a section that is
   * still resolving, which shows its own skeleton). Placeholders for other
   * statuses belong to this component. */
  renderBlock(block: PageBlock): ReactNode;
  /** Address of another listing's page; plain links keep history and
   * middle-click, and `onOpen` lets a router take over an ordinary click. */
  listingHref(listingId: string): string;
  onOpen?: ((listingId: string) => void) | undefined;
  className?: string | undefined;
};

const IDENTIFIERS = [
  ["isin", "ISIN"],
  ["lei", "LEI"],
  ["cik", "CIK"],
  ["figi", "FIGI"],
  ["caip19", "CAIP-19"],
] as const;

/** Grid placement by block type: prices lead, the profile sits beside them on
 * wide screens and filings span the page. One column on narrow screens. */
const SPAN: Record<PageBlock["type"], string> = {
  market: "@3xl:col-span-2",
  quote: "",
  chart: "@3xl:col-span-2",
  profile: "",
  filings: "@3xl:col-span-3",
  other: "",
};

/** The Koyfin-like subject page: header, listing switcher and one card per
 * page block. Header and card frames render from the local page composition
 * alone; each card's content loads on its own. */
export function InstrumentPage({
  page,
  renderBlock,
  listingHref,
  onOpen,
  className,
}: InstrumentPageProps) {
  return (
    <article
      data-slot="instrument-page"
      aria-label={page.subject.name}
      className={cn(
        "@container mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 min-[600px]:px-6",
        className,
      )}
    >
      <InstrumentHeader page={page} />
      <ListingSwitcher page={page} listingHref={listingHref} onOpen={onOpen} />
      <div className="grid @3xl:grid-cols-3 grid-cols-1 gap-3">
        {pageBlocks(page.sections).map((block) => (
          <SectionCard
            key={block.key}
            block={block}
            className={SPAN[block.type]}
          >
            {block.type !== "other" &&
            block.sections.every(
              (section) =>
                section.status === "ready" || section.status === "resolving",
            ) ? (
              renderBlock(block)
            ) : (
              <SectionPlaceholder
                section={block.sections[0] as SubjectSection}
                level={page.subject.level}
              />
            )}
          </SectionCard>
        ))}
      </div>
      {page.sections.length === 0 ? (
        <p className="text-body text-foreground-secondary">
          No installed plugin can show data for this{" "}
          {page.subject.level.replaceAll("_", " ")} yet.
        </p>
      ) : null}
    </article>
  );
}

function currentListing(page: SubjectPage): SubjectListing | undefined {
  return (
    page.listings.find((listing) => listing.id === page.subject.id) ??
    page.listings.find((listing) => listing.primary)
  );
}

function InstrumentHeader({ page }: { page: SubjectPage }) {
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

function ListingSwitcher({
  page,
  listingHref,
  onOpen,
}: Pick<InstrumentPageProps, "page" | "listingHref" | "onOpen">) {
  if (page.listings.length < 2) return null;
  const open = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (
      !onOpen ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <nav
      aria-label="Listings"
      data-slot="instrument-listings"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {page.listings.map((listing) => {
        const current = listing.id === page.subject.id;
        return (
          <a
            key={listing.id}
            href={listingHref(listing.id)}
            onClick={(event) => open(event, listing.id)}
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
          </a>
        );
      })}
    </nav>
  );
}

function SectionCard({
  block,
  className,
  children,
}: {
  block: PageBlock;
  className?: string;
  children: ReactNode;
}) {
  const lead = block.sections[0] as SubjectSection;
  return (
    <section
      aria-label={block.title}
      data-slot="instrument-section"
      data-section={block.type}
      data-status={lead.status}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-container border border-border/60 bg-container p-4",
        className,
      )}
    >
      <h2 className="font-semibold text-body text-foreground">{block.title}</h2>
      <div className="min-w-0 flex-1">{children}</div>
      <SourcesLine section={lead} />
    </section>
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
