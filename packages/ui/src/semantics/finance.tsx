import type { ReactNode } from "react";
import { cn } from "../class-name";
import { FreshnessLabel } from "./research";
import type { FreshnessKind, MarketDirectionKind } from "./types";

const directionPresentation: Record<
  MarketDirectionKind,
  { cue: string; label: string; tone: string }
> = {
  up: { cue: "↑", label: "Up", tone: "text-market-up" },
  down: { cue: "↓", label: "Down", tone: "text-market-down" },
  unchanged: { cue: "→", label: "Unchanged", tone: "text-market-flat" },
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
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 font-semibold text-sm",
        presentation.tone,
        className,
      )}
      data-direction={direction}
      data-slot="market-direction"
    >
      <span aria-hidden="true" className="font-bold">
        {presentation.cue}
      </span>
      <span>{presentation.label}</span>
      <span className="font-bold tabular-nums">{value}</span>
      {context === undefined ? null : (
        <span className="font-normal text-foreground-secondary text-xs">
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
      className={cn("m-0 grid gap-3 border-border border-y py-4", className)}
      data-slot="financial-value"
    >
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-foreground">
        <strong className="font-semibold text-lg tabular-nums">{value}</strong>
        <span className="font-semibold text-foreground-secondary text-xs">
          {currencyOrUnit}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-foreground-secondary text-xs">
        <div className="flex gap-1">
          <dt className="font-semibold text-foreground">Period</dt>
          <dd className="m-0">{period}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="font-semibold text-foreground">Basis</dt>
          <dd className="m-0">{basis}</dd>
        </div>
      </dl>
      <FreshnessLabel state={freshness} />
    </figure>
  );
}
