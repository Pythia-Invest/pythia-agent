"use client";
import {
  parseFilings,
  parseProfile,
  type SubjectPage,
  type SubjectSection,
} from "@pythia/market-data/subject";
import {
  CHART_PERIOD_LABELS,
  CHART_PERIODS,
  type ChartPeriod,
  type ChartWidgetInput,
  type FinancialWidgetInput,
} from "@pythia/market-data/widgets";
import { Button, cn, InstrumentPeriodSelector } from "@pythia/ui";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import {
  useResolvedSections,
  useSectionRead,
  useSubjectPage,
  useWidgetPresentation,
} from "@/client/instrument-queries";
import { BoundWidget } from "@/components/widgets/bound-widget";
import {
  creditedSources,
  type PageBlock,
  pageBlocks,
  pickedSource,
  type SourcePick,
  usingSource,
} from "./blocks";
import { InstrumentHeader, InstrumentPageSkeleton } from "./instrument-header";
import { FilingsRead } from "./filings-view";
import { LiveMarketView } from "./live-view";
import {
  NoDataNote,
  SectionFailure,
  SectionLoading,
  SectionPlaceholder,
  SectionRead,
  SourcesLine,
} from "./section-status";
import { ProfileView } from "./section-views";

/** Canonical price presentations of the market-data feature: the price
 * section with its chart, and the quote-only panel. */
const MARKET_PLUGIN = "pythia-market-data";
const MARKET_PRESENTATION = "instrument-panel";
const CHART_PRESENTATION = "instrument-chart";

/** Blocks that show the chosen listing's price. */
const PRICE_BLOCKS = new Set<PageBlock["type"]>(["market", "quote", "chart"]);

/** Grid placement by block type: prices lead, the profile sits beside them on
 * wide screens and filings span the page. One column on narrow screens. */
const SPAN: Record<PageBlock["type"], string> = {
  market: "@3xl:col-span-2",
  quote: "",
  chart: "@3xl:col-span-2",
  live: "@3xl:col-span-3",
  profile: "",
  filings: "@3xl:col-span-3",
  other: "",
};

/** The routed instrument page (Koyfin-like): header, listing switcher and one
 * card per page block. The composition is a fast local read, often already
 * prefetched by search, so header and card frames render at once; each card's
 * content then loads on its own. */
export function InstrumentSurface({ subjectId }: { subjectId: string }) {
  // `?listing=` names the listing whose quote and chart the page shows; the
  // selector changes it in place (history.replaceState), so the page and the
  // issuer's profile and filings stay mounted with their reads. Only a listing
  // of this instrument is honoured: an unknown or foreign id shows the route
  // subject instead of failing or showing another instrument.
  const requested = useSearchParams().get("listing");
  const instrument = useSubjectPage(subjectId);
  const listingId =
    requested &&
    instrument.data?.listings.some((listing) => listing.id === requested)
      ? requested
      : null;
  const listing = useSubjectPage(listingId ?? subjectId);
  // A chosen listing that cannot be read fails in its price card only; the
  // instrument's own composition carries the rest of the page.
  const listingFailed = Boolean(
    listingId && listing.isError && instrument.data,
  );
  const page = listingFailed ? instrument : listing;
  // Until the chosen listing's own composition arrives, its price blocks wait
  // instead of mounting on the previous or the route's line.
  const awaitingListing = Boolean(listingId && listing.isPlaceholderData);
  // Resolution follows the composition on screen: while another listing's
  // composition loads, the previous one (a placeholder) keeps its cached
  // resolutions and nothing is resolved on its behalf.
  const resolved = useResolvedSections(
    page.data?.subject.id ?? listingId ?? subjectId,
    subjectId,
    page.data?.sections ?? [],
  );
  if (page.isPending) return <InstrumentPageSkeleton />;
  if (page.isError)
    return (
      <div
        role="alert"
        className="mx-auto flex w-full max-w-6xl flex-col items-start gap-2 px-4 py-8 min-[600px]:px-6"
      >
        <p className="font-semibold text-body text-foreground">
          This instrument could not be opened.
        </p>
        <p className="text-foreground-secondary text-xs">
          {page.error.message ||
            "The local identity service did not answer. Check that Pythia is running."}
        </p>
        {/* Asking again cannot find a subject core does not know. */}
        {"code" in page.error &&
        page.error.code === "unknown_subject" ? null : (
          <Button size="sm" variant="ghost" onClick={() => void page.refetch()}>
            Retry
          </Button>
        )}
      </div>
    );
  const view = { ...page.data, sections: resolved.sections };
  // The header is the instrument's (the route subject's kind, name and
  // identifiers); only the price and chart follow the chosen listing.
  const header = instrument.data ?? view;
  return (
    <article
      data-slot="instrument-page"
      aria-label={header.subject.name}
      className="@container mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 min-[600px]:px-6"
    >
      <InstrumentHeader page={header} subjectId={subjectId} />
      <div className="grid @3xl:grid-cols-3 grid-cols-1 gap-3">
        {pageBlocks(view.sections).map((block) => (
          <PageCard
            key={block.key}
            block={block}
            page={view}
            retry={block.sections
              .map((section) => resolved.failed.get(section))
              .find(Boolean)}
            price={
              !PRICE_BLOCKS.has(block.type) ? null : listingFailed ? (
                <SectionFailure
                  message={`This listing's price could not be read. ${listing.error?.message ?? ""}`}
                  onRetry={() => void listing.refetch()}
                />
              ) : awaitingListing ? (
                <SectionLoading
                  label="Loading this listing's price…"
                  lines={4}
                />
              ) : null
            }
          />
        ))}
      </div>
      {view.sections.length === 0 ? (
        <NoDataNote level={view.subject.level} />
      ) : null}
    </article>
  );
}

/** One card: its content and its sources; the investor may show it from an
 * alternative source once. */
function PageCard({
  block: original,
  page,
  retry,
  price,
}: {
  block: PageBlock;
  page: SubjectPage;
  retry: (() => void) | undefined;
  /** The chosen listing's price state, when it replaces a price block. */
  price: ReactNode;
}) {
  const [pick, setPick] = useState<SourcePick | null>(null);
  // Use-once (D1): the pick lapses on another listing or once core no longer
  // offers that source.
  const chosen = pickedSource(original, pick, page.subject.id);
  const block = usingSource(original, chosen);
  const servable =
    block.type !== "other" &&
    block.sections.every(
      (section) => section.status === "ready" || section.status === "resolving",
    );
  // The filings list's own read (shared with its content) names the sources
  // that supplied its rows.
  const read = useSectionRead(
    block.type === "filings" && servable ? block.sections[0]?.request : null,
  );
  const lead = creditedSources(
    block.sections[0] as SubjectSection,
    read.data ? filingsOrNull(read.data) : null,
  );
  return (
    <section
      aria-label={block.title}
      data-slot="instrument-section"
      data-section={block.type}
      data-status={lead.status}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-container border border-border/60 bg-container p-4",
        SPAN[block.type],
      )}
    >
      <h2 className="font-semibold text-body text-foreground">{block.title}</h2>
      <div className="min-w-0 flex-1">
        {price ? (
          price
        ) : servable ? (
          <BlockContent
            block={block}
            page={page}
            retryResolve={chosen ? undefined : retry}
          />
        ) : (
          <SectionPlaceholder
            section={chosen ? lead : (original.sections[0] as SubjectSection)}
            level={page.subject.level}
          />
        )}
      </div>
      {/* Another listing's price loading or failing: this line's sources
          would describe the wrong line. A price no source covers lists each
          source's reason in its card instead; a card that needs the issuer
          has no source to name. */}
      {price ||
      lead.status === "not_covering" ||
      lead.status === "not_addressable" ? null : (
        <SourcesLine
          section={lead}
          chosen={chosen}
          onUse={(plugin) =>
            setPick(plugin ? { plugin, subject: page.subject.id } : null)
          }
        />
      )}
    </section>
  );
}

/** A read that is not a filings list (its card shows why) credits nothing. */
function filingsOrNull(value: unknown) {
  try {
    return parseFilings(value);
  } catch {
    return null;
  }
}

function BlockContent({
  block,
  page,
  retryResolve,
}: {
  block: PageBlock;
  page: SubjectPage;
  retryResolve: (() => void) | undefined;
}) {
  const lead = block.sections[0] as SubjectSection;
  if (retryResolve)
    return (
      <SectionFailure
        message={`${lead.label} could not be reached to find this instrument.`}
        onRetry={retryResolve}
      />
    );
  if (block.sections.some((section) => section.status === "resolving"))
    return (
      <SectionLoading label={`Finding this instrument in ${lead.label}…`} />
    );
  if (block.type === "profile")
    return (
      <SectionRead section={lead} label="Loading profile…">
        {(value) => <ProfileView profile={parseProfile(value)} />}
      </SectionRead>
    );
  if (block.type === "live") return <LiveMarketView section={lead} />;
  if (block.type === "filings") return <FilingsRead section={lead} />;
  return <MarketSection block={block} page={page} />;
}

/** Quote and chart through the market-data feature's own widgets, bound to
 * the section's explicit provider reference; Desk only hosts the module and
 * keeps the selected chart period (1D intraday by default). */
function MarketSection({
  block,
  page,
}: {
  block: PageBlock;
  page: SubjectPage;
}) {
  const presentation = useWidgetPresentation(MARKET_PLUGIN);
  const [period, setPeriod] = useState<ChartPeriod>("1D");
  const lead = block.sections[0] as SubjectSection;
  const chart = block.type !== "quote";
  const id = chart ? CHART_PRESENTATION : MARKET_PRESENTATION;
  const widget = presentation.data?.widgets.find((item) => item.id === id);
  const moduleUrl = presentation.data?.assets.find(
    (asset) => asset.id === widget?.asset,
  )?.moduleUrl;
  if (presentation.isPending)
    return <SectionLoading label="Loading price widget…" lines={4} />;
  if (!moduleUrl)
    return (
      <SectionFailure
        message="The market-data price widget is unavailable. Check that the market-data plugin is enabled."
        onRetry={() => void presentation.refetch()}
      />
    );
  if (!lead.binding)
    return <SectionFailure message="This section has no source address." />;
  const listing =
    page.listings.find((item) => item.id === page.subject.id) ??
    page.listings.find((item) => item.primary);
  const symbol = page.identifiers.ticker ?? listing?.ticker ?? "";
  if (chart) {
    const input: ChartWidgetInput = {
      subject: lead.binding,
      symbol,
      name: page.subject.name,
      period,
    };
    return (
      <div className="flex flex-col gap-2">
        <InstrumentPeriodSelector
          periods={CHART_PERIODS.map((value) => ({
            id: value,
            label: CHART_PERIOD_LABELS[value],
          }))}
          value={period}
          onValueChange={(value) => setPeriod(value as ChartPeriod)}
          className="self-end"
        />
        <BoundWidget
          moduleUrl={moduleUrl}
          name={`${block.title} · ${lead.label}`}
          presentation={CHART_PRESENTATION}
          input={input}
        />
      </div>
    );
  }
  const options = {
    range: true,
    unit: true,
    change: "both" as const,
    path: false,
  };
  const input: FinancialWidgetInput = {
    widget: "instrument-tile",
    options,
    source: {
      feed: "prices",
      subjects: [
        {
          subject: lead.binding,
          symbol,
          name: page.subject.name,
          price: { mode: "preferred", criteria: {} },
        },
      ],
    },
  };
  return (
    <BoundWidget
      moduleUrl={moduleUrl}
      name={`${block.title} · ${lead.label}`}
      presentation={MARKET_PRESENTATION}
      input={input}
      options={options}
    />
  );
}
