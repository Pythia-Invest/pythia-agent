import { SemanticMessage } from "@pythia/ui";

export function Tones() {
  return (
    <div className="flex flex-col gap-3">
      <SemanticMessage title="Filing coverage extended" tone="information">
        Three additional quarters were added to this issuer from the local
        archive.
      </SemanticMessage>
      <SemanticMessage title="Watchlist saved" tone="success">
        Twelve holdings were written to your local workspace.
      </SemanticMessage>
      <SemanticMessage title="Source date needs review" tone="warning">
        The latest filing predates the reporting period you selected. A warning
        is an interface state, never a Pythia signal about the investment.
      </SemanticMessage>
      <SemanticMessage title="Import failed" tone="error">
        The positions file could not be parsed. No records were changed.
      </SemanticMessage>
    </div>
  );
}

export function TitleOnly() {
  return (
    <div className="flex flex-col gap-3">
      <SemanticMessage title="Six new filings are available." tone="information" />
      <SemanticMessage title="Export complete." tone="success" />
    </div>
  );
}
