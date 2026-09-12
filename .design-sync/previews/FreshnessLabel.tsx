import { FreshnessLabel } from "@pythia/ui";

export function States() {
  return (
    <div className="flex flex-col gap-3">
      <FreshnessLabel detail="as at 12 April 2028, 09:30 UTC" state="current" />
      <FreshnessLabel detail="quoted on a 15-minute lag" state="delayed" />
      <FreshnessLabel
        detail="newest filing on hand is dated 09 February 2028"
        state="stale"
      />
      <FreshnessLabel detail="the source carries no date" state="unknown" />
      <span className="mt-2 max-w-lg text-foreground-secondary text-xs leading-relaxed">
        All four supplied recency classifications. The component does not read
        the clock or compare dates — the caller establishes the state and
        formats the detail.
      </span>
    </div>
  );
}

export function WithoutDetail() {
  return (
    <div className="flex flex-col gap-3">
      <FreshnessLabel state="current" />
      <FreshnessLabel state="delayed" />
      <FreshnessLabel state="stale" />
      <FreshnessLabel state="unknown" />
      <span className="mt-2 max-w-lg text-foreground-secondary text-xs leading-relaxed">
        Detail is optional. Staleness stays a property of the evidence and is
        never rendered as an interface error.
      </span>
    </div>
  );
}

export function BesideTheEvidence() {
  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="text-foreground">
          Northstar Materials · FY 2028 revenue · € 1,842m
        </span>
        <FreshnessLabel detail="filed 31 March 2028" state="current" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="text-foreground">
          Kestrel Logistics · last traded price · € 12.85
        </span>
        <FreshnessLabel detail="15-minute lag" state="delayed" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="text-foreground">
          Aldergrove Utilities · net debt / EBITDA · 4.0×
        </span>
        <FreshnessLabel detail="FY 2027 annual report" state="stale" />
      </div>
    </div>
  );
}
