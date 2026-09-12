import { Input, Label } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="input-default-issuer">Issuer name</Label>
      <Input
        defaultValue="Northstar Materials (synthetic)"
        id="input-default-issuer"
      />
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-size-sm">Ticker filter (sm)</Label>
        <Input defaultValue="NSTM" id="input-size-sm" size="sm" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-size-md">Ticker filter (md)</Label>
        <Input defaultValue="NSTM" id="input-size-md" size="md" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-size-lg">Ticker filter (lg)</Label>
        <Input defaultValue="NSTM" id="input-size-lg" size="lg" />
      </div>
    </div>
  );
}

export function States() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-state-empty">Watchlist name</Label>
        <Input
          id="input-state-empty"
          placeholder="e.g. European industrials"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-state-invalid">Reporting period</Label>
        <Input defaultValue="FY2019" id="input-state-invalid" invalid />
        <p className="m-0 text-foreground-secondary text-xs">
          Marked invalid by the application: filings start at FY2021.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-state-readonly">Source archive</Label>
        <Input
          defaultValue="Local filing archive"
          id="input-state-readonly"
          readOnly
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-state-disabled">Broker account</Label>
        <Input
          defaultValue="Not connected"
          disabled
          id="input-state-disabled"
        />
      </div>
    </div>
  );
}

export function NumericEntry() {
  return (
    <div className="grid w-full max-w-md grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-numeric-shares">Shares held</Label>
        <Input
          className="tabular-nums"
          defaultValue="1,250"
          id="input-numeric-shares"
          inputMode="numeric"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="input-numeric-basis">Cost basis</Label>
        <Input
          className="tabular-nums"
          defaultValue="42.75"
          id="input-numeric-basis"
          inputMode="decimal"
        />
      </div>
    </div>
  );
}
