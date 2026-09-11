import { Calendar, type CalendarDateString } from "@pythia/ui";

const month = "2028-04-01" as CalendarDateString;
const today = "2028-04-12" as CalendarDateString;
const selected = "2028-04-14" as CalendarDateString;
const closedDates = [
  "2028-04-06",
  "2028-04-20",
] as const satisfies readonly CalendarDateString[];

export function Default() {
  return (
    <Calendar
      aria-label="Choose a review date"
      month={month}
      today={today}
      value={selected}
    />
  );
}

export function UnavailableDates() {
  return (
    <div className="flex flex-col gap-3">
      <Calendar
        aria-label="Choose a filing date"
        disabledDates={closedDates}
        month={month}
        today={today}
        value={selected}
      />
      <p className="max-w-xs text-foreground-secondary text-xs leading-relaxed">
        6 and 20 April are unavailable; the exchange is closed on those invented
        dates.
      </p>
    </div>
  );
}

export function NoSelection() {
  return (
    <div className="flex flex-col gap-3">
      <Calendar aria-label="Choose a review date" month={month} today={today} />
      <p className="max-w-xs text-foreground-secondary text-xs leading-relaxed">
        Nothing selected. 12 April carries the supplied today marker; no ambient
        clock is read.
      </p>
    </div>
  );
}

export function Disabled() {
  return (
    <Calendar
      aria-label="Review date, locked"
      disabled
      month={month}
      today={today}
      value={selected}
    />
  );
}
