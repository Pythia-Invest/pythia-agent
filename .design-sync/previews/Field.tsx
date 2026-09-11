import { Field, Input, InputGroup, Textarea } from "@pythia/ui";

export function Default() {
  return (
    <div className="w-full max-w-md">
      <Field
        description="Shown on the watchlist and in exported reports."
        label="Watchlist name"
        name="watchlist"
      >
        <Input defaultValue="European industrials" />
      </Field>
    </div>
  );
}

export function WithError() {
  return (
    <div className="w-full max-w-md">
      <Field
        description="Four quarters ending on the issuer's fiscal year end."
        error="Filings for Northstar Materials (synthetic) start at FY2021."
        invalid
        label="Reporting period"
        name="period"
      >
        <Input defaultValue="FY2019" invalid />
      </Field>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-full max-w-md">
      <Field
        description="Connect a broker in Settings to import positions."
        disabled
        label="Broker account"
        name="broker"
      >
        <Input defaultValue="Not connected" disabled />
      </Field>
    </div>
  );
}

export function PositionForm() {
  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <Field
        description="Ticker as it appears in your local archive."
        label="Symbol"
        name="symbol"
      >
        <Input defaultValue="NSTM" />
      </Field>
      <Field
        description="Average price paid across all lots."
        label="Cost basis"
        name="cost-basis"
      >
        <InputGroup end="USD" start="$">
          <Input className="tabular-nums" defaultValue="42.75" />
        </InputGroup>
      </Field>
      <Field
        description="Why this position exists. Stored locally."
        label="Thesis"
        name="thesis"
      >
        <Textarea
          defaultValue="Specialty coatings pricing held through the FY2025 destocking cycle."
          rows={3}
        />
      </Field>
    </div>
  );
}
