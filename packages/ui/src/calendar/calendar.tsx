"use client";

import {
  DayFlag,
  DayPicker,
  SelectionState,
  UI,
  type Matcher,
} from "react-day-picker";
import { cn } from "../class-name";
import {
  calendarDateToUTCDate,
  type CalendarDateString,
  parseCalendarDate,
  utcDateToCalendarDate,
} from "./calendar-date";

/** Props for the UTC-safe, single-date calendar pattern. */
export interface CalendarProps {
  /** Accessible name for the calendar container. */
  "aria-label"?: string | undefined;
  className?: string | undefined;
  /** Disables the entire calendar without changing its selected value. */
  disabled?: boolean | undefined;
  /** Calendar dates unavailable for selection. */
  disabledDates?: readonly CalendarDateString[] | undefined;
  /** Explicit initial visible month, as a validated calendar date. */
  month: CalendarDateString;
  /** Emits a selected calendar date; applications own state and validation. */
  onValueChange?: ((value: CalendarDateString | undefined) => void) | undefined;
  /** Explicit date carrying today's presentation; no ambient clock is read. */
  today: CalendarDateString;
  /** Controlled selected calendar date. */
  value?: CalendarDateString | undefined;
}

const navButton =
  "pointer-events-auto inline-flex size-9 items-center justify-center rounded-control border border-transparent text-foreground-secondary hover:bg-interaction-hover disabled:opacity-disabled";

const calendarClassNames = {
  [UI.Root]: "relative w-fit text-sm text-foreground",
  [UI.Months]: "flex flex-col gap-4 sm:flex-row",
  [UI.Month]: "space-y-3",
  [UI.MonthCaption]: "flex h-9 items-center justify-center px-10",
  [UI.CaptionLabel]: "text-sm font-semibold",
  [UI.Nav]:
    "pointer-events-none absolute inset-x-0 top-0 flex h-9 items-center justify-between",
  [UI.PreviousMonthButton]: navButton,
  [UI.NextMonthButton]: navButton,
  [UI.Chevron]: "size-4 fill-current",
  [UI.MonthGrid]: "w-full border-collapse",
  [UI.Weekdays]: "flex",
  [UI.Weekday]:
    "flex size-9 items-center justify-center text-xs font-medium text-foreground-secondary",
  [UI.Weeks]: "block",
  [UI.Week]: "mt-1 flex",
  [UI.Day]: "relative size-9 p-0 text-center",
  [UI.DayButton]:
    "inline-flex size-9 items-center justify-center rounded-control text-sm hover:bg-interaction-hover focus-visible:relative focus-visible:z-10",
  [SelectionState.selected]:
    "[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground [&>button:hover]:bg-primary [&>button:hover]:text-primary-foreground [&[data-today]]:after:bg-primary-foreground",
  [DayFlag.today]:
    "after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-foreground",
  // Outside-month dates are quieter than disabled ones on purpose.
  [DayFlag.outside]: "text-foreground-disabled opacity-55",
  [DayFlag.disabled]: "pointer-events-none",
  [DayFlag.hidden]: "invisible",
} as const;

/**
 * Single-date calendar backed entirely by React DayPicker selection mechanics.
 *
 * It accepts only validated `YYYY-MM-DD` value/month/today/disabled dates and
 * emits the same boundary type. Selected, today, disabled, and focus states use
 * semantic tokens across Public/Product and both themes. DayPicker owns grid,
 * arrow/PageUp/PageDown keyboard navigation, focus, and selection. Do supply
 * explicit `today` and `month`; don't pass native Date or add calendar logic.
 */
export function Calendar({
  "aria-label": ariaLabel = "Choose date",
  className,
  disabled = false,
  disabledDates = [],
  month,
  onValueChange,
  today,
  value,
}: CalendarProps) {
  const selectedDate = value
    ? calendarDateToUTCDate(parseCalendarDate(value))
    : undefined;
  const todayDate = calendarDateToUTCDate(parseCalendarDate(today));
  const initialMonth = calendarDateToUTCDate(parseCalendarDate(month));
  const unavailableDates = disabledDates.map((date) =>
    calendarDateToUTCDate(parseCalendarDate(date)),
  );
  const disabledMatcher: Matcher | Matcher[] | undefined = disabled
    ? true
    : unavailableDates.length > 0
      ? unavailableDates
      : undefined;

  return (
    <DayPicker
      aria-label={ariaLabel}
      className={cn(
        "rounded-container border border-border bg-raised p-3",
        disabled && "opacity-disabled",
        className,
      )}
      classNames={{
        ...calendarClassNames,
        // A fully disabled calendar fades once at the root; single dates fade individually.
        [DayFlag.disabled]: disabled
          ? calendarClassNames[DayFlag.disabled]
          : `${calendarClassNames[DayFlag.disabled]} opacity-disabled`,
      }}
      data-slot="calendar"
      defaultMonth={initialMonth}
      disableNavigation={disabled}
      disabled={disabledMatcher}
      mode="single"
      onSelect={(nextValue) =>
        onValueChange?.(
          nextValue ? utcDateToCalendarDate(nextValue) : undefined,
        )
      }
      selected={selectedDate}
      showOutsideDays
      timeZone="UTC"
      today={todayDate}
    />
  );
}
