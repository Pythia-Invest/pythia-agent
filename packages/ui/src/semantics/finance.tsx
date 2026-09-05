import { clsx } from "clsx";
import type { ReactNode } from "react";
import { FreshnessLabel } from "./research";
import type { FreshnessKind, MarketDirectionKind } from "./types";

const directionPresentation: Record<
  MarketDirectionKind,
  { cue: string; label: string; token: string }
> = {
  up: {
    cue: "↑",
    label: "Up",
    token: "[color:var(--py-market-up)]",
  },
  down: {
    cue: "↓",
    label: "Down",
    token: "[color:var(--py-market-down)]",
  },
  unchanged: {
    cue: "→",
    label: "Unchanged",
    token: "[color:var(--py-market-flat)]",
  },
};

export interface MarketDirectionProps {
  /** Caller-supplied direction; it is not derived from `value`. */
  direction: MarketDirectionKind;
  /** Already formatted movement or comparison value. */
  value: ReactNode;
  /** Optional caller-supplied comparison context. */
  context?: ReactNode;
  className?: string;
}

/**
 * Presents up, down, or unchanged market movement with a directional sign,
 * explicit label, supplied value, and optional context. Direction is the only
 * variant and remains independent of analytical impact. Shared semantic tokens
 * adapt to light/dark in both profiles; the display is non-interactive. Do
 * supply a normalized direction and formatted value; do not use it to compute
 * change, infer good/bad, or express recommendation.
 */
export function MarketDirection({
  className,
  context,
  direction,
  value,
}: MarketDirectionProps) {
  const presentation = directionPresentation[direction];
  return (
    <span
      className={clsx(
        "inline-flex flex-wrap items-baseline gap-x-[var(--py-space-2)] gap-y-[var(--py-space-1)] text-[length:var(--py-font-size-14)] font-semibold",
        presentation.token,
        className,
      )}
    >
      <span aria-hidden="true" className="font-bold">
        {presentation.cue}
      </span>
      <span>{presentation.label}</span>
      <span className="font-bold tabular-nums">{value}</span>
      {context === undefined ? null : (
        <span className="text-[length:var(--py-font-size-12)] font-normal [color:var(--py-text-secondary)]">
          {context}
        </span>
      )}
    </span>
  );
}

export interface FinancialValueProps {
  /** Already formatted primary value; no formatting or arithmetic is applied. */
  value: ReactNode;
  /** Currency, unit, ratio, or multiple label required to interpret the value. */
  currencyOrUnit: ReactNode;
  /** Relevant caller-formatted reporting or estimate period. */
  period: ReactNode;
  /** Supplied basis such as reported, adjusted, estimate, or per-share. */
  basis: ReactNode;
  /** Supplied evidence freshness, independent of the value itself. */
  freshness: FreshnessKind;
  /** Accessible group label, defaulting to `Financial value`. */
  label?: string;
  className?: string;
}

/**
 * Keeps a supplied financial value together with unit/currency, period, basis,
 * and freshness. All meaning-bearing fields are required; missing-data states
 * belong in `KnowledgeState`. Public/Product density and themes flow through
 * shared tokens, while tabular numerals aid scanning; there is no interaction.
 * Do pass application-formatted display values; do not calculate, round,
 * compare, normalize time, or fabricate a placeholder here.
 */
export function FinancialValue({
  basis,
  className,
  currencyOrUnit,
  freshness,
  label = "Financial value",
  period,
  value,
}: FinancialValueProps) {
  return (
    <figure
      className={clsx(
        "m-0 grid gap-[var(--py-space-3)] border-y border-solid [border-color:var(--py-border-default)] py-[var(--py-space-4)]",
        className,
      )}
    >
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex flex-wrap items-baseline gap-x-[var(--py-space-2)] gap-y-[var(--py-space-1)] [color:var(--py-text-primary)]">
        <strong className="text-[length:var(--py-font-size-18)] font-semibold tabular-nums">
          {value}
        </strong>
        <span className="text-[length:var(--py-font-size-12)] font-semibold [color:var(--py-text-secondary)]">
          {currencyOrUnit}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-[var(--py-space-4)] gap-y-[var(--py-space-1)] text-[length:var(--py-font-size-12)] [color:var(--py-text-secondary)]">
        <div className="flex gap-[var(--py-space-1)]">
          <dt className="font-semibold [color:var(--py-text-primary)]">
            Period
          </dt>
          <dd className="m-0">{period}</dd>
        </div>
        <div className="flex gap-[var(--py-space-1)]">
          <dt className="font-semibold [color:var(--py-text-primary)]">
            Basis
          </dt>
          <dd className="m-0">{basis}</dd>
        </div>
      </dl>
      <FreshnessLabel state={freshness} />
    </figure>
  );
}
