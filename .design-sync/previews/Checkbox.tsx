import { Checkbox } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex items-center gap-2">
      <Checkbox aria-labelledby="cb-default" defaultChecked />
      <span className="text-foreground text-sm" id="cb-default">
        Include unaudited interim filings
      </span>
    </div>
  );
}

export function States() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-off" />
        <span className="text-foreground text-sm" id="cb-off">
          Restate to reporting currency
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-on" defaultChecked />
        <span className="text-foreground text-sm" id="cb-on">
          Adjust for share buybacks
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-mixed" indeterminate />
        <span className="text-foreground text-sm" id="cb-mixed">
          Segment detail (3 of 5 periods)
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-disabled" disabled />
        <span className="text-foreground-disabled text-sm" id="cb-disabled">
          Consensus estimates (no provider)
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-disabled-on" defaultChecked disabled />
        <span className="text-foreground-disabled text-sm" id="cb-disabled-on">
          Local archive (always on)
        </span>
      </div>
    </div>
  );
}

export function ScreenFilters() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg border border-border bg-canvas p-4">
      <span className="font-semibold text-foreground text-sm">
        Sector exposure
      </span>
      <div className="flex items-center gap-2">
        <Checkbox aria-labelledby="cb-sectors-all" indeterminate />
        <span className="font-medium text-foreground text-sm" id="cb-sectors-all">
          All sectors
        </span>
        <span className="ml-auto text-foreground-secondary text-xs tabular-nums">
          2 / 4
        </span>
      </div>
      <div className="flex flex-col gap-2 border-border border-l pl-4">
        <div className="flex items-center gap-2">
          <Checkbox aria-labelledby="cb-sector-industrials" defaultChecked />
          <span className="text-foreground text-sm" id="cb-sector-industrials">
            Industrials
          </span>
          <span className="ml-auto text-foreground-secondary text-xs tabular-nums">
            18
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox aria-labelledby="cb-sector-utilities" defaultChecked />
          <span className="text-foreground text-sm" id="cb-sector-utilities">
            Utilities
          </span>
          <span className="ml-auto text-foreground-secondary text-xs tabular-nums">
            11
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox aria-labelledby="cb-sector-materials" />
          <span className="text-foreground text-sm" id="cb-sector-materials">
            Materials
          </span>
          <span className="ml-auto text-foreground-secondary text-xs tabular-nums">
            9
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox aria-labelledby="cb-sector-financials" disabled />
          <span
            className="text-foreground-disabled text-sm"
            id="cb-sector-financials"
          >
            Financials
          </span>
          <span className="ml-auto text-foreground-disabled text-xs tabular-nums">
            0
          </span>
        </div>
      </div>
    </div>
  );
}

export function RowSelection() {
  const rows = [
    ["Northwind Grid Utilities", "NWGU", "FY 2028 annual report", true],
    ["Calder Metals", "CLDM", "Q3 2028 interim", true],
    ["Kestrel Logistics", "KSTL", "FY 2028 annual report", false],
  ] as const;

  return (
    <div className="flex w-full max-w-sm flex-col rounded-lg border border-border bg-canvas">
      <div className="flex items-center gap-3 border-border border-b px-3 py-2">
        <Checkbox aria-labelledby="cb-rows-all" indeterminate />
        <span
          className="font-medium text-foreground-secondary text-xs"
          id="cb-rows-all"
        >
          2 filings selected
        </span>
      </div>
      {rows.map(([issuer, ticker, filing, selected]) => (
        <div className="flex items-center gap-3 px-3 py-2" key={ticker}>
          <Checkbox aria-labelledby={`cb-row-${ticker}`} defaultChecked={selected} />
          <div className="flex min-w-0 flex-col">
            <span
              className="truncate text-foreground text-sm"
              id={`cb-row-${ticker}`}
            >
              {issuer}
            </span>
            <span className="text-foreground-secondary text-xs">{filing}</span>
          </div>
          <span className="ml-auto text-foreground-secondary text-xs tabular-nums">
            {ticker}
          </span>
        </div>
      ))}
    </div>
  );
}
