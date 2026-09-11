import { Input, Label, Textarea } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="label-default-watchlist">Watchlist name</Label>
      <Input
        defaultValue="European industrials"
        id="label-default-watchlist"
      />
    </div>
  );
}

export function Required() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="label-required-ticker">
        Ticker
        <span className="ml-1 text-foreground-secondary">(required)</span>
      </Label>
      <Input
        defaultValue="NSTM"
        id="label-required-ticker"
        placeholder="e.g. NSTM"
        required
      />
    </div>
  );
}

export function WithHelpText() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="label-help-thesis">Thesis summary</Label>
      <p
        className="m-0 text-foreground-secondary text-xs"
        id="label-help-thesis-help"
      >
        One or two sentences. Stored locally with the position, never sent to a
        provider.
      </p>
      <Textarea
        aria-describedby="label-help-thesis-help"
        defaultValue="Durable margin advantage in specialty coatings; watching FY2026 capex."
        id="label-help-thesis"
        rows={3}
      />
    </div>
  );
}

export function DisabledControl() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label
        className="text-foreground-disabled"
        htmlFor="label-disabled-account"
      >
        Broker account
      </Label>
      <Input
        defaultValue="Not connected"
        disabled
        id="label-disabled-account"
      />
    </div>
  );
}
