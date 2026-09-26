"use client";

import { ConnectorMark } from "@pythia/market-data/search-ui";
import type { SubjectSection } from "@pythia/market-data/subject";
import { Button, Skeleton } from "@pythia/ui";
import { CircleSlash, Scale, SearchX, Settings2, Shapes } from "lucide-react";
import type { ReactNode } from "react";

const STATUS_LABELS: Record<string, string> = {
  resolving: "finding match",
  needs_configuration: "needs configuration",
  unresolved: "no match",
  conflict: "under review",
  disabled: "turned off",
};

function levelName(level: string) {
  return level.replaceAll("_", " ");
}

function sentence(text: string) {
  const trimmed = text.trim();
  const first = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/u.test(first) ? first : `${first}.`;
}

/** Honest limitation, not a failure: why a section has no content and what
 * would change that. Neutral styling on purpose (docs/design.md). */
export function SectionPlaceholder({
  section,
  level,
}: {
  section: SubjectSection;
  level: string;
}) {
  const known: Record<
    string,
    { icon: ReactNode; title: string; fallback: string }
  > = {
    needs_configuration: {
      icon: <Settings2 />,
      title: `${section.label} needs configuration`,
      fallback: "Add the plugin's required settings, then reopen this page.",
    },
    unresolved: {
      icon: <SearchX />,
      title: `${section.label} has no match for this ${levelName(level)}`,
      fallback: "The source did not recognise this instrument's identifiers.",
    },
    conflict: {
      icon: <Scale />,
      title: `${section.label} match is under review`,
      fallback:
        "The source's identifiers disagree with the reference data; the agent reviews it.",
    },
    disabled: {
      icon: <CircleSlash />,
      title: `${section.label} is turned off`,
      fallback: "Enable the plugin to show this section.",
    },
  };
  const status = known[section.status];
  const unsupported = !["quote", "chart", "profile", "filings"].includes(
    section.section,
  );
  const shown = unsupported
    ? {
        icon: <Shapes />,
        title: `This Desk cannot show ${section.section.replaceAll("_", " ")} sections yet`,
        fallback: "",
      }
    : (status ?? {
        icon: <Shapes />,
        title: `${section.label}: ${section.status.replaceAll("_", " ")}`,
        fallback: "",
      });
  const detail = unsupported
    ? null
    : section.reason
      ? sentence(section.reason)
      : shown.fallback;
  return (
    <div
      role="note"
      data-slot="instrument-section-placeholder"
      className="flex min-h-24 items-start gap-3 rounded-control border border-border border-dashed px-3 py-3 [&_svg]:size-4 [&_svg]:flex-none [&_svg]:stroke-[1.6] [&_svg]:text-foreground-secondary"
    >
      <span aria-hidden="true" className="pt-0.5">
        {shown.icon}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-body text-foreground">{shown.title}</p>
        {detail ? (
          <p className="mt-0.5 text-foreground-secondary text-xs [overflow-wrap:anywhere]">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The chosen plugin and what else could serve the section, beside it. */
export function SourcesLine({ section }: { section: SubjectSection }) {
  const alternatives = section.alternatives.map((item) =>
    item.status === "ready"
      ? item.label
      : `${item.label} (${STATUS_LABELS[item.status] ?? item.status.replaceAll("_", " ")})`,
  );
  return (
    <p
      data-slot="instrument-sources"
      className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 border-border/60 border-t pt-2 text-[11px] text-foreground-secondary"
    >
      <span>Source</span>
      <ConnectorMark
        plugin={
          section.binding?.provider ??
          // Connector marks are keyed by provider, plugin ids by package.
          section.plugin.replace(/^pythia-/u, "").replace(/-discovery$/u, "")
        }
      />
      <span className="text-foreground">{section.label}</span>
      {section.status !== "ready" ? (
        <span>
          ·{" "}
          {STATUS_LABELS[section.status] ?? section.status.replaceAll("_", " ")}
        </span>
      ) : null}
      {alternatives.length ? (
        <span className="min-w-0">· Also: {alternatives.join(", ")}</span>
      ) : null}
    </p>
  );
}

/** Per-section loading geometry; one slow source never holds up the page. */
export function SectionLoading({
  label,
  lines = 3,
}: {
  label: string;
  lines?: number;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      data-slot="instrument-section-loading"
      className="flex flex-col gap-2 py-1"
    >
      <span className="text-foreground-secondary text-xs">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={index % 2 ? "w-2/3" : "w-5/6"} />
      ))}
    </div>
  );
}

/** A read that failed, distinct from an honest absence of data. */
export function SectionFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div
      role="alert"
      data-slot="instrument-section-error"
      className="flex flex-col items-start gap-2"
    >
      <p className="text-error text-xs">{message}</p>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
