import { Label, Textarea } from "@pythia/ui";

export function Default() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <Label htmlFor="textarea-default-note">Analyst note</Label>
      <Textarea
        defaultValue="Northstar Materials (synthetic) held gross margin above 38% through the FY2025 destocking cycle. Next check: whether the Q1 price increase sticks once the Meridian contract reprices."
        id="textarea-default-note"
      />
    </div>
  );
}

export function Sizes() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-size-sm">Quick comment (sm)</Label>
        <Textarea
          defaultValue="Trim on strength above 48."
          id="textarea-size-sm"
          rows={2}
          size="sm"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-size-md">Position rationale (md)</Label>
        <Textarea
          defaultValue="Adding on the FY2026 capex guide."
          id="textarea-size-md"
          rows={2}
          size="md"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-size-lg">Investment thesis (lg)</Label>
        <Textarea
          defaultValue="Pricing power survives the cycle."
          id="textarea-size-lg"
          rows={2}
          size="lg"
        />
      </div>
    </div>
  );
}

export function States() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-state-empty">Meeting notes</Label>
        <Textarea
          id="textarea-state-empty"
          placeholder="Summarise the management call…"
          rows={3}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-state-invalid">Thesis summary</Label>
        <Textarea
          defaultValue="TBD"
          id="textarea-state-invalid"
          invalid
          rows={2}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="textarea-state-disabled">Archived rationale</Label>
        <Textarea
          defaultValue="Exited the position in FY2024 after the Arbor Logistics spin-off."
          disabled
          id="textarea-state-disabled"
          rows={2}
        />
      </div>
    </div>
  );
}

export function ReadOnlyExcerpt() {
  return (
    <div className="flex w-full max-w-lg flex-col gap-2">
      <Label htmlFor="textarea-readonly-excerpt">
        Filing excerpt (read only)
      </Label>
      <Textarea
        defaultValue={`Item 7 — Management's Discussion and Analysis\n\n"Segment operating margin expanded 210 basis points, driven by mix and by the specialty coatings price actions taken in the second quarter."\n\nHelion Grid (synthetic), FY2025 annual report.`}
        id="textarea-readonly-excerpt"
        readOnly
        rows={6}
      />
    </div>
  );
}
