import { clsx } from "clsx";
import { type ReactNode, useId } from "react";
import type { EpistemicKind, FreshnessKind } from "./types";

const epistemicPresentation: Record<EpistemicKind, { label: string }> = {
  fact: {
    label: "Sourced fact",
  },
  machine: {
    label: "Machine assessment",
  },
  human: {
    label: "Human judgment",
  },
};

const freshnessPresentation: Record<FreshnessKind, { label: string }> = {
  current: {
    label: "Current",
  },
  delayed: {
    label: "Delayed",
  },
  stale: {
    label: "Stale",
  },
  unknown: {
    label: "Freshness unknown",
  },
};

export interface EpistemicLabelProps {
  /** The already-established owner/type of the claim. */
  kind: EpistemicKind;
  className?: string;
}

/**
 * Labels a claim as sourced fact, machine assessment, or human judgment.
 * `kind` is the only variant; the caller establishes it. Public/Product and
 * light/dark share quiet neutral presentation. The explicit words retain the
 * meaning without a duplicate letter cue. Do attach it to the claim; do
 * not use it to infer or certify the claim's evidence state.
 */
export function EpistemicLabel({ className, kind }: EpistemicLabelProps) {
  const presentation = epistemicPresentation[kind];
  return (
    <span
      className={clsx(
        "inline-flex items-baseline text-[length:var(--py-font-size-12)] font-medium [color:var(--py-text-secondary)]",
        className,
      )}
    >
      <span>{presentation.label}</span>
    </span>
  );
}

export interface FreshnessLabelProps {
  /** The supplied recency classification; this component does not compare dates. */
  state: FreshnessKind;
  /** Optional caller-formatted context such as an as-of date. */
  detail?: ReactNode;
  className?: string;
}

/**
 * Presents current, delayed, stale, or unknown freshness in explicit words.
 * `state` selects the meaning and `detail` adds caller-formatted context. It
 * follows shared profile/theme semantic tokens and has no keyboard behavior.
 * Do place it beside the evidence it qualifies; do not ask it to normalize
 * dates, read the clock, or turn staleness into an interface error.
 */
export function FreshnessLabel({
  className,
  detail,
  state,
}: FreshnessLabelProps) {
  const presentation = freshnessPresentation[state];
  return (
    <span
      className={clsx(
        "inline-flex flex-wrap items-baseline gap-x-[var(--py-space-2)] gap-y-[var(--py-space-1)] text-[length:var(--py-font-size-12)] font-medium [color:var(--py-text-secondary)]",
        className,
      )}
    >
      <span>{presentation.label}</span>
      {detail === undefined ? null : (
        <span className="font-normal [color:var(--py-text-secondary)]">
          {detail}
        </span>
      )}
    </span>
  );
}

export interface SourceMetadataProps {
  /** Human-readable source identity supplied by the application. */
  source: ReactNode;
  /** Caller-formatted publication or effective date. */
  sourceDate: ReactNode;
  /** Caller-formatted retrieval time for live-web evidence, when applicable. */
  retrievedAt?: ReactNode;
  className?: string;
}

/**
 * Keeps source identity, source date, and optional retrieval time together.
 * Its only state is whether `retrievedAt` is supplied. The flat definition
 * list uses shared Public/Product and light/dark tokens, is non-interactive,
 * and needs no keyboard handling. Do provide normalized, trusted display
 * values; do not use this component to fetch, date-normalize, or verify them.
 */
export function SourceMetadata({
  className,
  retrievedAt,
  source,
  sourceDate,
}: SourceMetadataProps) {
  return (
    <dl
      className={clsx(
        "flex flex-wrap gap-x-[var(--py-space-4)] gap-y-[var(--py-space-1)] text-[length:var(--py-font-size-12)] [color:var(--py-text-secondary)]",
        className,
      )}
    >
      <MetadataItem label="Source" value={source} />
      <MetadataItem label="Source date" value={sourceDate} />
      {retrievedAt === undefined ? null : (
        <MetadataItem label="Retrieved" value={retrievedAt} />
      )}
    </dl>
  );
}

export interface CitationProps extends SourceMetadataProps {
  /** Visible citation marker already assigned by the consuming application. */
  marker: string;
  /** Exact caller-supplied passage, section, page, or record locator. */
  locator: ReactNode;
}

/**
 * Presents a citation marker, exact locator, and source metadata at point of
 * use. Props are display-only and have no unresolved/loading states. It stays
 * flat across profiles and themes and intentionally has no link or keyboard
 * behavior. Do pair it with application-owned safe navigation; do not use it
 * to resolve a source, validate a quote, assign IDs, or authorize a URL.
 */
export function Citation({
  className,
  locator,
  marker,
  retrievedAt,
  source,
  sourceDate,
}: CitationProps) {
  return (
    <figure
      aria-label={`Citation ${marker}`}
      className={clsx(
        "m-0 flex min-w-0 items-start gap-[var(--py-space-3)] border-y border-solid [border-color:var(--py-border-default)] py-[var(--py-space-3)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="shrink-0 text-[length:var(--py-font-size-12)] font-bold [color:var(--py-text-primary)]"
      >
        [{marker}]
      </span>
      <figcaption className="grid min-w-0 gap-[var(--py-space-2)]">
        <span className="text-[length:var(--py-font-size-12)] font-semibold [color:var(--py-text-primary)]">
          {locator}
        </span>
        <SourceMetadata
          source={source}
          sourceDate={sourceDate}
          {...(retrievedAt === undefined ? {} : { retrievedAt })}
        />
      </figcaption>
    </figure>
  );
}

export interface ProvenanceProps {
  /** Supplied epistemic owner of the claim. */
  epistemic: EpistemicKind;
  /** Plain-language source, method, or reasoning basis supplied by the caller. */
  basis: ReactNode;
  /** Relevant caller-formatted reporting or analysis period. */
  period?: ReactNode;
  /** Optional source identity when a full citation is not shown here. */
  source?: ReactNode;
  /** Optional supplied evidence freshness. */
  freshness?: FreshnessKind;
  className?: string;
}

/**
 * Keeps a conclusion's supplied epistemic owner, basis, period, source, and
 * freshness beside it. Optional fields render only when present; no state is
 * inferred. The flat, labelled layout uses shared profile/theme tokens and is
 * non-interactive. Do use it as nearby provenance; do not turn it into a
 * detached bibliography or ask it to judge whether the basis is sufficient.
 */
export function Provenance({
  basis,
  className,
  epistemic,
  freshness,
  period,
  source,
}: ProvenanceProps) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-x-[var(--py-space-4)] gap-y-[var(--py-space-2)] border-y border-solid [border-color:var(--py-border-default)] py-[var(--py-space-3)]",
        className,
      )}
    >
      <EpistemicLabel kind={epistemic} />
      <dl className="flex flex-wrap gap-x-[var(--py-space-4)] gap-y-[var(--py-space-1)] text-[length:var(--py-font-size-12)] [color:var(--py-text-secondary)]">
        <MetadataItem label="Basis" value={basis} />
        {period === undefined ? null : (
          <MetadataItem label="Period" value={period} />
        )}
        {source === undefined ? null : (
          <MetadataItem label="Source" value={source} />
        )}
      </dl>
      {freshness === undefined ? null : <FreshnessLabel state={freshness} />}
    </div>
  );
}

export interface PythiaSignalProps {
  /** The supplied material item Pythia surfaced for attention. */
  title: ReactNode;
  /** Supporting interpretation or evidence summary. */
  children?: ReactNode;
  /** Optional caller-composed provenance placed beneath the signal. */
  metadata?: ReactNode;
  className?: string;
}

/**
 * Gives an explicitly supplied Pythia signal the canonical Oracle-seam
 * treatment: a neutral surface, one vertical amber-to-transparent seam, and
 * the visible `Pythia signal` label. `title`, body, and optional metadata are
 * presentation-only. Existing profile tokens adjust spacing and themes remap
 * neutral tokens; there is no interaction or keyboard behavior. Do reserve
 * this for a real supplied signal; do not use it for warnings, actions,
 * selection, market direction, or automated detection.
 */
export function PythiaSignal({
  children,
  className,
  metadata,
  title,
}: PythiaSignalProps) {
  const titleId = useId();
  return (
    <aside
      aria-labelledby={titleId}
      className={clsx(
        "pythia-signal relative grid overflow-hidden gap-[var(--py-space-6)] border-y border-solid [border-color:var(--py-border-default)] bg-[var(--py-surface-raised)] px-[var(--py-space-6)] py-[var(--py-space-6)] [color:var(--py-text-primary)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pythia-signal__seam absolute inset-y-0 start-0 w-[3px] bg-[linear-gradient(to_bottom,var(--py-signal-marker),transparent)]"
      />
      <div className="pythia-signal__label text-[length:var(--py-font-size-12)] font-bold uppercase tracking-[0.08em]">
        Pythia signal
      </div>
      <div className="pythia-signal__body grid max-w-[72ch] gap-[var(--py-space-3)]">
        <div
          className="pythia-signal__title m-0 text-[length:clamp(1.35rem,3vw,2rem)] font-semibold leading-[var(--py-line-height-tight)]"
          id={titleId}
        >
          {title}
        </div>
        {children === undefined ? null : (
          <div className="text-[length:var(--py-profile-body-size)] leading-[var(--py-line-height-reading)] [color:var(--py-text-secondary)]">
            {children}
          </div>
        )}
      </div>
      {metadata === undefined ? null : (
        <footer className="pythia-signal__metadata border-t border-solid [border-color:var(--py-border-default)] pt-[var(--py-space-3)] text-[length:var(--py-font-size-12)] [color:var(--py-text-secondary)]">
          {metadata}
        </footer>
      )}
    </aside>
  );
}

function MetadataItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-[var(--py-space-1)]">
      <dt className="font-semibold [color:var(--py-text-primary)]">{label}</dt>
      <dd className="m-0 min-w-0">{value}</dd>
    </div>
  );
}
