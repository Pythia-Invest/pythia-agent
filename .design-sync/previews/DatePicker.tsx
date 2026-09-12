import { DatePicker, type CalendarDateString } from "@pythia/ui";

const month = "2028-04-01" as CalendarDateString;
const today = "2028-04-12" as CalendarDateString;
const selected = "2028-04-14" as CalendarDateString;
const closedDates = [
  "2028-04-06",
  "2028-04-20",
] as const satisfies readonly CalendarDateString[];

export function Default() {
  return (
    <div className="w-full max-w-xs">
      <DatePicker
        description="Fixed reporting schedule; no ambient clock is read."
        disabledDates={closedDates}
        label="Review date"
        month={month}
        today={today}
        value={selected}
      />
    </div>
  );
}

export function Empty() {
  return (
    <div className="w-full max-w-xs">
      <DatePicker
        label="Evidence date"
        month={month}
        placeholder="Select a date"
        today={today}
      />
    </div>
  );
}

export function FormattedValue() {
  return (
    <div className="w-full max-w-xs">
      <DatePicker
        description="displayValue changes presentation only; the boundary stays YYYY-MM-DD."
        displayValue="14 April 2028"
        label="Period end"
        month={month}
        today={today}
        value={selected}
      />
    </div>
  );
}

export function WithError() {
  return (
    <div className="w-full max-w-xs">
      <DatePicker
        error="Choose a date on or before the period end."
        label="Evidence date"
        month={month}
        today={today}
      />
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-full max-w-xs">
      <DatePicker
        description="Locked while the filing import runs."
        disabled
        label="Review date"
        month={month}
        today={today}
        value={selected}
      />
    </div>
  );
}
