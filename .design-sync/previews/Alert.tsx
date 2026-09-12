import { Alert, Button } from "@pythia/ui";

export function Tones() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <Alert title="Filing coverage extended" tone="info">
        Three additional quarters for Example Components plc (fictional) were
        added from the local archive.
      </Alert>
      <Alert title="Watchlist saved" tone="success">
        Twelve holdings were written to your local workspace.
      </Alert>
      <Alert title="Check the reporting date" tone="warning">
        The latest filing predates Synthetic FY 2031. This conventional warning
        is distinct from a Pythia signal about the investment.
      </Alert>
      <Alert title="Import failed" tone="error">
        The positions file could not be parsed. No records were changed.
      </Alert>
    </div>
  );
}

export function WithAction() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <Alert
        action={<Button variant="secondary">Review</Button>}
        title="Six new filings are available"
        tone="info"
      >
        Retrieved 2032-04-13 for four issuers on the Quality screen.
      </Alert>
      <Alert
        action={<Button variant="secondary">Retry</Button>}
        title="Price refresh failed"
        tone="error"
      >
        The local snapshot for the invented exchange is unchanged.
      </Alert>
    </div>
  );
}

export function TitleOnly() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <Alert title="Export complete." tone="success" />
      <Alert title="Two holdings are missing a period end." tone="warning" />
    </div>
  );
}

export function InPanel() {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 rounded-lg border border-border bg-raised p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-semibold text-base text-foreground">
          Example Components plc (fictional)
        </span>
        <span className="text-foreground-secondary text-xs">
          As of 2032-04-12
        </span>
      </div>
      <Alert title="Segment table is machine-extracted" tone="warning">
        Values below Synthetic FY 2031 come from an invented synthesis and have
        not been checked against the source filing.
      </Alert>
      <p className="text-foreground-secondary text-sm leading-relaxed">
        Illustrative revenue €486m · Illustrative operating margin 14.2%
      </p>
    </div>
  );
}
