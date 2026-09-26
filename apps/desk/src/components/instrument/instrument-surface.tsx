"use client";
import {
  parseFilings,
  parseProfile,
  type SubjectPage,
  type SubjectSection,
} from "@pythia/market-data/subject";
import type { FinancialWidgetInput } from "@pythia/market-data/widgets";
import { Button, cn } from "@pythia/ui";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  useResolvedSections,
  useSectionRead,
  useSubjectPage,
  useWidgetPresentation,
} from "@/client/instrument-queries";
import { BoundWidget } from "@/components/widgets/bound-widget";
import { type PageBlock, pageBlocks } from "./blocks";
import { InstrumentHeader, InstrumentPageSkeleton } from "./instrument-header";
import {
  SectionFailure,
  SectionLoading,
  SectionPlaceholder,
  SourcesLine,
} from "./section-status";
import { FilingsView, ProfileView } from "./section-views";

/** Canonical price presentation of the market-data feature. */
const MARKET_PLUGIN = "pythia-market-data";
const MARKET_PRESENTATION = "instrument-panel";

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
  const page = useSubjectPage(listingId ?? subjectId);
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
        <Button size="sm" variant="ghost" onClick={() => void page.refetch()}>
          Retry
        </Button>
      </div>
    );
  const view = { ...page.data, sections: resolved.sections };
  return (
    <article
      data-slot="instrument-page"
      aria-label={view.subject.name}
      className="@container mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 min-[600px]:px-6"
    >
      <InstrumentHeader page={view} subjectId={subjectId} />
      <div className="grid @3xl:grid-cols-3 grid-cols-1 gap-3">
        {pageBlocks(view.sections).map((block) => {
          const retry = block.sections
            .map((section) => resolved.failed.get(section))
            .find(Boolean);
          const servable =
            block.type !== "other" &&
            block.sections.every(
              (section) =>
                section.status === "ready" || section.status === "resolving",
            );
          return (
            <SectionCard
              key={block.key}
              block={block}
              className={SPAN[block.type]}
            >
              {servable ? (
                <BlockContent block={block} page={view} retryResolve={retry} />
              ) : (
                <SectionPlaceholder
                  section={block.sections[0] as SubjectSection}
                  level={view.subject.level}
                />
              )}
            </SectionCard>
          );
        })}
      </div>
      {view.sections.length === 0 ? (
        <p className="text-body text-foreground-secondary">
          No installed plugin can show data for this{" "}
          {view.subject.level.replaceAll("_", " ")} yet.
        </p>
      ) : null}
    </article>
  );
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
  if (block.type === "filings")
    return (
      <SectionRead section={lead} label="Loading filings…">
        {(value) => <FilingsView filings={parseFilings(value)} />}
      </SectionRead>
    );
  return <MarketSection block={block} page={page} />;
}

/** One section's own read through the protected read route. */
function SectionRead({
  section,
  label,
  children,
}: {
  section: SubjectSection;
  label: string;
  children(value: unknown): ReactNode;
}) {
  const query = useSectionRead(section.request);
  if (!section.request)
    return <SectionFailure message="This section has no read to show." />;
  if (query.error)
    return (
      <SectionFailure
        message={`${section.label} could not be read. ${query.error.message}`}
        onRetry={() => void query.refetch()}
      />
    );
  if (query.isPending) return <SectionLoading label={label} />;
  try {
    return children(query.data);
  } catch (error) {
    const shape = error instanceof Error && error.name === "ZodError";
    return (
      <SectionFailure
        message={`${section.label}: ${shape || !(error instanceof Error) ? "the answer had an unexpected shape." : error.message}`}
        onRetry={() => void query.refetch()}
      />
    );
  }
}

/** Quote and chart through the market-data feature's own widget, bound to the
 * section's explicit provider reference; Desk only hosts the module. */
function MarketSection({
  block,
  page,
}: {
  block: PageBlock;
  page: SubjectPage;
}) {
  const presentation = useWidgetPresentation(MARKET_PLUGIN);
  const lead = block.sections[0] as SubjectSection;
  const widget = presentation.data?.widgets.find(
    (item) => item.id === MARKET_PRESENTATION,
  );
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
  const chart = block.type !== "quote";
  const listing =
    page.listings.find((item) => item.id === page.subject.id) ??
    page.listings.find((item) => item.primary);
  const options = chart
    ? { range: true, unit: true, change: "both" as const, pathHeight: 64 }
    : { range: true, unit: true, change: "both" as const, path: false };
  const input: FinancialWidgetInput = {
    widget: "instrument-tile",
    options,
    source: {
      feed: "prices",
      subjects: [
        {
          subject: lead.binding,
          symbol: page.identifiers.ticker ?? listing?.ticker ?? "",
          name: page.subject.name,
          price: { mode: "preferred", criteria: {} },
          ...(chart
            ? {
                // Hourly bars are the one interval every price connector
                // offers once, so the explicit source stays unambiguous.
                history: {
                  selection: {
                    mode: "preferred" as const,
                    criteria: { interval: { kind: "hour" as const, count: 1 } },
                  },
                  window: { kind: "rolling" as const, days: 5 },
                  completion: "any" as const,
                },
              }
            : {}),
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
