import { Radio, RadioGroup } from "@pythia/ui";

export function Default() {
  return (
    <RadioGroup
      aria-label="Reporting cadence"
      defaultValue="quarterly"
      name="cadence"
    >
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-monthly" value="monthly" />
        <span className="text-foreground text-sm" id="rg-monthly">
          Monthly
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-quarterly" value="quarterly" />
        <span className="text-foreground text-sm" id="rg-quarterly">
          Quarterly
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-annual" value="annual" />
        <span className="text-foreground text-sm" id="rg-annual">
          Annual
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-live" disabled value="live" />
        <span className="text-foreground-disabled text-sm" id="rg-live">
          Live (no market data provider)
        </span>
      </div>
    </RadioGroup>
  );
}

export function Horizontal() {
  return (
    <RadioGroup
      aria-label="Reporting currency"
      orientation="horizontal"
      defaultValue="eur"
      name="currency"
    >
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-eur" value="eur" />
        <span className="text-foreground text-sm" id="rg-eur">
          EUR
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-gbp" value="gbp" />
        <span className="text-foreground text-sm" id="rg-gbp">
          GBP
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-usd" value="usd" />
        <span className="text-foreground text-sm" id="rg-usd">
          USD
        </span>
      </div>
    </RadioGroup>
  );
}

export function DescribedOptions() {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-canvas p-4">
      <span className="font-semibold text-foreground text-sm">
        Valuation basis
      </span>
      <RadioGroup
        aria-label="Valuation basis"
        className="mt-3"
        defaultValue="normalised"
        name="valuation-basis"
      >
        <div className="flex items-start gap-3">
          <Radio aria-labelledby="rg-reported" value="reported" />
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground text-sm" id="rg-reported">
              As reported
            </span>
            <span className="text-foreground-secondary text-xs leading-relaxed">
              Uses each issuer's filed figures without adjustment.
            </span>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Radio aria-labelledby="rg-normalised" value="normalised" />
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground text-sm" id="rg-normalised">
              Normalised
            </span>
            <span className="text-foreground-secondary text-xs leading-relaxed">
              Strips one-off items across the last eight reporting periods.
            </span>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Radio aria-labelledby="rg-owner" value="owner" />
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground text-sm" id="rg-owner">
              Owner earnings
            </span>
            <span className="text-foreground-secondary text-xs leading-relaxed">
              Cash earnings after maintenance capital expenditure.
            </span>
          </div>
        </div>
      </RadioGroup>
    </div>
  );
}

export function DisabledGroup() {
  return (
    <RadioGroup
      aria-label="Benchmark"
      defaultValue="none"
      disabled
      name="benchmark"
    >
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-none" value="none" />
        <span className="text-foreground-disabled text-sm" id="rg-none">
          No benchmark
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-broad" value="broad" />
        <span className="text-foreground-disabled text-sm" id="rg-broad">
          Broad European index
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Radio aria-labelledby="rg-peers" value="peers" />
        <span className="text-foreground-disabled text-sm" id="rg-peers">
          Custom peer set
        </span>
      </div>
    </RadioGroup>
  );
}
