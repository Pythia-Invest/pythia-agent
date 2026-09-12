import { Badge } from "@pythia/ui";

export function Tones() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>Neutral</Badge>
      <Badge tone="info">Information</Badge>
      <Badge tone="success">Complete</Badge>
      <Badge tone="warning">Review</Badge>
      <Badge tone="error">Failed</Badge>
    </div>
  );
}

export function ResearchLabels() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="info">As of 2032-04-12</Badge>
      <Badge tone="neutral">2 supplied values</Badge>
      <Badge tone="neutral">Synthetic FY 2031</Badge>
      <Badge tone="success">Filing matched</Badge>
      <Badge tone="warning">Period end missing</Badge>
    </div>
  );
}

export function InWatchlist() {
  return (
    <div className="flex w-full max-w-lg flex-col rounded-lg border border-border bg-raised">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3">
        <span className="font-semibold text-foreground text-sm">Watchlist</span>
        <Badge tone="neutral">3 issuers</Badge>
      </div>
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <span className="text-foreground text-sm">
          Example Components plc (fictional)
        </span>
        <Badge tone="success">Filing current</Badge>
      </div>
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <span className="text-foreground text-sm">
          Northgate Materials NV (fictional)
        </span>
        <Badge tone="warning">Delayed</Badge>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <span className="text-foreground text-sm">
          Harbour Ledger SA (fictional)
        </span>
        <Badge tone="error">Import failed</Badge>
      </div>
    </div>
  );
}
