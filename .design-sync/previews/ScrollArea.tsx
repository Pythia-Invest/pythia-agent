import { ScrollArea } from "@pythia/ui";

const filings = [
  ["Annual report FY 2028", "Northstar Materials", "14 Feb 2029"],
  ["Q3 2028 interim statement", "Northstar Materials", "07 Nov 2028"],
  ["Capital markets update", "Northstar Materials", "22 Sep 2028"],
  ["Annual report FY 2028", "Kestrel Logistics", "31 Jan 2029"],
  ["Fleet impairment note", "Kestrel Logistics", "12 Dec 2028"],
  ["Annual report FY 2028", "Aldergrove Utilities", "19 Jan 2029"],
  ["Tariff decision commentary", "Aldergrove Utilities", "03 Oct 2028"],
  ["Annual report FY 2028", "Vantage Bioscience", "08 Feb 2029"],
  ["Phase II readout", "Vantage Bioscience", "27 Nov 2028"],
  ["Annual report FY 2028", "Meridian Foods", "05 Feb 2029"],
  ["Input cost briefing", "Meridian Foods", "16 Oct 2028"],
  ["Annual report FY 2028", "Harbour Line Shipping", "29 Jan 2029"],
];

const quarters = [
  ["Q1 2028", "412", "18.2%"],
  ["Q2 2028", "438", "18.9%"],
  ["Q3 2028", "451", "19.4%"],
  ["Q4 2028", "467", "19.1%"],
  ["Q1 2029", "479", "19.8%"],
  ["Q2 2029", "486", "20.2%"],
  ["Q3 2029", "494", "20.0%"],
  ["Q4 2029", "503", "20.6%"],
];

export function FilingArchive() {
  return (
    <div style={{ height: "15rem" }}>
      <ScrollArea className="h-full">
        <div className="flex flex-col p-3 gap-3">
          {filings.map(([title, issuer, date]) => (
            <div className="flex flex-col gap-1" key={`${issuer}-${title}-${date}`}>
              <span className="font-medium text-sm">{title}</span>
              <span className="text-foreground-secondary text-xs">
                {issuer} · filed {date}
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export function HorizontalPeriods() {
  return (
    <ScrollArea orientation="horizontal">
      <div className="flex gap-4 p-3">
        {quarters.map(([period, revenue, margin]) => (
          <div
            className="flex flex-col gap-1 rounded-lg border border-border p-3 shrink-0"
            key={period}
            style={{ width: "9rem" }}
          >
            <span className="text-foreground-secondary text-xs whitespace-nowrap">
              {period}
            </span>
            <span className="font-semibold tabular-nums">€ {revenue}m</span>
            <span className="text-foreground-secondary text-xs tabular-nums">
              {margin} gross margin
            </span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function BothAxes() {
  return (
    <div style={{ height: "14rem" }}>
      <ScrollArea className="h-full" orientation="both">
        <div className="flex flex-col p-3 gap-2" style={{ width: "56rem" }}>
          {filings.map(([title, issuer, date]) => (
            <div
              className="flex items-baseline gap-6 whitespace-nowrap"
              key={`${issuer}-${title}-${date}-wide`}
            >
              <span className="text-sm" style={{ width: "16rem" }}>
                {issuer}
              </span>
              <span className="text-foreground-secondary text-sm" style={{ width: "18rem" }}>
                {title}
              </span>
              <span className="text-foreground-secondary text-xs tabular-nums">
                filed {date} · retrieved from the local archive on 02 March 2029
              </span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
