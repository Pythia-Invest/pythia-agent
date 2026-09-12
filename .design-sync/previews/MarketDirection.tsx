import { MarketDirection } from "@pythia/ui";

export function Directions() {
  return (
    <div className="flex flex-col gap-3">
      <MarketDirection
        context="one synthetic session · 12 April 2028"
        direction="up"
        value="+2.4%"
      />
      <MarketDirection
        context="one synthetic session · 12 April 2028"
        direction="down"
        value="−1.8%"
      />
      <MarketDirection
        context="one synthetic session · 12 April 2028"
        direction="unchanged"
        value="0.0%"
      />
      <span className="mt-2 max-w-lg text-foreground-secondary text-xs leading-relaxed">
        Movement only. Up is not favourable and down is not unfavourable — the
        component carries no view on the investment case, and the direction is
        supplied rather than derived from the value.
      </span>
    </div>
  );
}

export function ValueOnly() {
  return (
    <div className="flex flex-col gap-3">
      <MarketDirection direction="up" value="+ € 0.42" />
      <MarketDirection direction="down" value="− 130 bps" />
      <MarketDirection direction="unchanged" value="0.0 pts" />
      <span className="mt-2 max-w-lg text-foreground-secondary text-xs leading-relaxed">
        Context is optional, and the value is a display string the application
        already formatted — currency, basis points and index points all pass
        through unchanged.
      </span>
    </div>
  );
}

export function InAQuoteList() {
  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="font-medium text-foreground">Northstar Materials</span>
        <span className="tabular-nums text-foreground-secondary text-sm">
          € 38.10
        </span>
        <MarketDirection context="vs previous close" direction="up" value="+2.4%" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="font-medium text-foreground">Kestrel Logistics</span>
        <span className="tabular-nums text-foreground-secondary text-sm">
          € 12.85
        </span>
        <MarketDirection context="vs previous close" direction="down" value="−1.8%" />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3">
        <span className="font-medium text-foreground">Aldergrove Utilities</span>
        <span className="tabular-nums text-foreground-secondary text-sm">
          € 21.40
        </span>
        <MarketDirection
          context="vs previous close"
          direction="unchanged"
          value="0.0%"
        />
      </div>
      <span className="text-foreground-secondary text-xs">
        Synthetic issuers and prices, quoted on a 15-minute lag.
      </span>
    </div>
  );
}
