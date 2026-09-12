import { Field, Input, InputGroup, Label } from "@pythia/ui";
import { Search } from "lucide-react";

export function Adornments() {
  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-amount">Cost basis</Label>
        <InputGroup end="USD" start="$">
          <Input
            className="tabular-nums"
            defaultValue="42.75"
            id="group-amount"
            inputMode="decimal"
          />
        </InputGroup>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-weight">Target weight</Label>
        <InputGroup end="%">
          <Input
            className="tabular-nums"
            defaultValue="4.5"
            id="group-weight"
            inputMode="decimal"
          />
        </InputGroup>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="group-multiple">Forward earnings multiple</Label>
        <InputGroup end="×" start="≤">
          <Input
            className="tabular-nums"
            defaultValue="18.0"
            id="group-multiple"
            inputMode="decimal"
          />
        </InputGroup>
      </div>
    </div>
  );
}

export function LeadingIcon() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="group-search">Find an issuer</Label>
      <InputGroup start={<Search aria-hidden="true" />}>
        <Input
          id="group-search"
          placeholder="Ticker or company name"
          type="search"
        />
      </InputGroup>
    </div>
  );
}

export function Invalid() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="group-invalid">Target weight</Label>
      <InputGroup end="%" invalid>
        <Input
          className="tabular-nums"
          defaultValue="140"
          id="group-invalid"
          invalid
        />
      </InputGroup>
      <p className="m-0 text-foreground-secondary text-xs">
        The application marks the group invalid; the group never validates.
      </p>
    </div>
  );
}

export function DisabledControl() {
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <Label htmlFor="group-disabled">Realised gain</Label>
      <InputGroup end="USD" start="$">
        <Input
          className="tabular-nums"
          defaultValue="0.00"
          disabled
          id="group-disabled"
        />
      </InputGroup>
    </div>
  );
}

export function InField() {
  return (
    <div className="w-full max-w-md">
      <Field
        description="Alerts fire when the last close crosses this level."
        label="Price alert"
        name="alert"
      >
        <InputGroup end="USD" start="≥">
          <Input className="tabular-nums" defaultValue="48.00" />
        </InputGroup>
      </Field>
    </div>
  );
}
