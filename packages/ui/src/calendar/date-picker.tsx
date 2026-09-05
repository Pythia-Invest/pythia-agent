"use client";

import { Popover } from "@base-ui/react/popover";
import { CalendarDays } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Calendar, type CalendarProps } from "./calendar";
import { type CalendarDateString, parseCalendarDate } from "./calendar-date";

/** Props for the labelled calendar-popover date picker pattern. */
export interface DatePickerProps
  extends Pick<
    CalendarProps,
    "disabled" | "disabledDates" | "month" | "onValueChange" | "today" | "value"
  > {
  className?: string;
  description?: ReactNode;
  /** Display content for the value; defaults to its unformatted YYYY-MM-DD. */
  displayValue?: ReactNode;
  /** Application-owned error content; DatePicker performs no field validation. */
  error?: ReactNode;
  /** Persistent visible field label. */
  label: string;
  placeholder?: string;
}

/**
 * Persistent-label date picker composing Base UI Popover and UTC DayPicker.
 *
 * It accepts controlled `YYYY-MM-DD` value plus explicit month/today and shows
 * disabled/error/empty states; `displayValue` may change presentation without
 * changing the boundary. Semantic tokens adapt across profiles/themes. Base UI
 * owns opening, dismissal, focus return, and Escape; DayPicker owns calendar
 * keyboard/selection. Do keep state/validation in the app; don't pass Date,
 * timestamps, or add custom focus and calendar machinery.
 */
export function DatePicker({
  className,
  description,
  disabled,
  disabledDates,
  displayValue,
  error,
  label,
  month,
  onValueChange,
  placeholder = "Select a date",
  today,
  value,
}: DatePickerProps) {
  parseCalendarDate(month);
  parseCalendarDate(today);
  if (value) {
    parseCalendarDate(value);
  }
  for (const disabledDate of disabledDates ?? []) {
    parseCalendarDate(disabledDate);
  }

  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [
    description ? descriptionId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  const visibleValue: ReactNode = displayValue ?? value ?? placeholder;

  return (
    <div
      className={`py-field grid gap-1.5 text-[var(--py-text-primary)] ${className ?? ""}`}
      data-disabled={disabled ? "" : undefined}
    >
      <span className="text-sm font-semibold leading-[var(--py-line-height-ui)]">
        {label}
      </span>
      {description ? (
        <p
          className="m-0 text-xs leading-[var(--py-line-height-ui)] text-[var(--py-text-secondary)]"
          id={descriptionId}
        >
          {description}
        </p>
      ) : null}
      <Popover.Root>
        <Popover.Trigger
          aria-describedby={describedBy || undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-label={`${label}: ${value ?? placeholder}`}
          className="py-field-control inline-flex min-h-[var(--py-profile-control-height)] w-full items-center justify-between gap-3 rounded-[var(--py-radius-interactive)] border border-[var(--py-border-default)] bg-[var(--py-surface-raised)] px-3 text-left text-sm text-[var(--py-text-primary)] hover:bg-[var(--py-interaction-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--py-focus-ring)] aria-invalid:border-[var(--py-status-error-border)]"
          disabled={disabled}
        >
          <span
            className={value ? undefined : "text-[var(--py-text-disabled)]"}
          >
            {visibleValue}
          </span>
          <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="start" className="z-50" sideOffset={8}>
            <Popover.Popup className="rounded-[var(--py-radius-group)] bg-[var(--py-surface-overlay)] shadow-xl outline-none">
              <Calendar
                disabled={disabled}
                disabledDates={disabledDates}
                month={month}
                onValueChange={onValueChange}
                today={today}
                value={value}
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {error ? (
        <p
          className="m-0 text-xs font-medium leading-[var(--py-line-height-ui)] text-[var(--py-status-error-foreground)]"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Re-exported date-string type used by DatePicker controlled state. */
export type { CalendarDateString };
