"use client";
import type { PageBlock } from "./blocks";
import { InstrumentPage, InstrumentPageSkeleton } from "./instrument-page";
import { SectionFailure, SectionLoading } from "./section-status";
import { FilingsView, ProfileView } from "./section-views";
import {
  parseFilings,
  parseProfile,
  type SubjectPage,
  type SubjectSection,
} from "@pythia/market-data/subject";
import type { FinancialWidgetInput } from "@pythia/market-data/widgets";
import { Button } from "@pythia/ui";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  useResolvedSections,
  useSubjectPage,
  useWidgetPresentation,
} from "@/client/instrument-queries";
import { usePluginWidgetData } from "@/client/plugin-queries";
import { BoundWidget } from "@/components/widgets/bound-widget";
import { instrumentHref } from "./instrument-href";

/** Canonical price presentation of the market-data feature. */
const MARKET_PLUGIN = "pythia-market-data";
const MARKET_PRESENTATION = "instrument-panel";

/** The routed instrument page. The composition is a fast local read (often
 * already prefetched by search); each section then loads on its own. */
export function InstrumentSurface({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const page = useSubjectPage(subjectId);
  const resolved = useResolvedSections(subjectId, page.data?.sections ?? []);
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
  return (
    <InstrumentPage
      page={{ ...page.data, sections: resolved.sections }}
      listingHref={instrumentHref}
      onOpen={(id) => router.push(instrumentHref(id))}
      renderBlock={(block) => (
        <BlockContent
          block={block}
          page={page.data}
          retryResolve={resolved.failed.get(block.sections[0]?.plugin ?? "")}
        />
      )}
    />
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
  const request = section.request;
  const query = usePluginWidgetData(
    request ?? { plugin: section.plugin, operation: "none", arguments: {} },
    Boolean(request),
  );
  if (!request)
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
  } catch {
    return (
      <SectionFailure
        message={`${section.label} answered in an unexpected shape.`}
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
