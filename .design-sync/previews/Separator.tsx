import { Separator } from "@pythia/ui";

export function SectionDivisions() {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-raised p-4 max-w-md">
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Thesis</span>
        <span className="text-foreground-secondary text-sm leading-relaxed">
          Northstar Materials trades below its replacement cost while the
          smelter restart is unfinanced.
        </span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Evidence</span>
        <span className="text-foreground-secondary text-sm leading-relaxed">
          FY 2028 annual report, pages 42 to 47, and the March 2029 capital
          markets update.
        </span>
      </div>
      <Separator />
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Open question</span>
        <span className="text-foreground-secondary text-sm leading-relaxed">
          No disclosure yet on the refinancing covenant.
        </span>
      </div>
    </div>
  );
}

function VerticalRule() {
  return (
    <div className="self-center" style={{ height: "1.125rem", width: "1px" }}>
      <Separator className="h-full" orientation="vertical" />
    </div>
  );
}

export function InlineMetadata() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-3 py-2">
        <span className="text-sm whitespace-nowrap">Annual report 2028</span>
        <VerticalRule />
        <span className="text-foreground-secondary text-sm whitespace-nowrap">
          Filed 14 February 2029
        </span>
        <VerticalRule />
        <span className="text-foreground-secondary text-sm whitespace-nowrap">
          PDF · 4.1 MB
        </span>
        <VerticalRule />
        <span className="text-foreground-secondary text-sm whitespace-nowrap">
          Local archive
        </span>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-3 py-2">
        <span className="text-sm whitespace-nowrap">Facts</span>
        <VerticalRule />
        <span className="text-sm whitespace-nowrap">Judgment</span>
        <VerticalRule />
        <span className="text-sm whitespace-nowrap">Unknown</span>
      </div>
    </div>
  );
}

export function ListDividers() {
  const rows = [
    { name: "Northstar Materials", sector: "Industrials", weight: "4.2%" },
    { name: "Kestrel Logistics", sector: "Transport", weight: "3.6%" },
    { name: "Aldergrove Utilities", sector: "Utilities", weight: "2.9%" },
    { name: "Vantage Bioscience", sector: "Healthcare", weight: "1.4%" },
  ];
  return (
    <div className="flex flex-col rounded-lg border border-border bg-raised p-4 max-w-md">
      {rows.map((row, index) => (
        <div className="flex flex-col" key={row.name}>
          {index === 0 ? null : (
            <div className="py-3">
              <Separator />
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate">{row.name}</span>
            <span className="text-foreground-secondary text-xs whitespace-nowrap">
              {row.sector}
            </span>
            <span className="font-semibold tabular-nums text-sm whitespace-nowrap">
              {row.weight}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
