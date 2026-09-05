import { TZDate } from "@date-fns/tz";

/** A runtime-validated Gregorian calendar date in exact `YYYY-MM-DD` form. */
export type CalendarDateString = `${number}-${number}-${number}`;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_BY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Checks exact syntax and Gregorian validity without interpreting an instant.
 * Use it at untrusted application boundaries; don't substitute ambient Date or
 * locale parsing.
 */
export function isCalendarDateString(
  value: unknown,
): value is CalendarDateString {
  if (typeof value !== "string") {
    return false;
  }

  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const ordinaryLimit = DAYS_BY_MONTH[month - 1];
  if (ordinaryLimit === undefined) {
    return false;
  }
  const limit = month === 2 && isLeapYear(year) ? 29 : ordinaryLimit;
  return day <= limit;
}

/**
 * Returns a validated calendar-date string or throws a boundary TypeError.
 * Use before storing/passing calendar values; don't use it to parse timestamps.
 */
export function parseCalendarDate(value: string): CalendarDateString {
  if (!isCalendarDateString(value)) {
    throw new TypeError(
      `Invalid calendar date "${value}"; expected a real YYYY-MM-DD date`,
    );
  }
  return value;
}

/** Internal DayPicker adapter: calendar date to a UTC TZDate. */
export function calendarDateToUTCDate(value: CalendarDateString): TZDate {
  const validated = parseCalendarDate(value);
  const [yearText, monthText, dayText] = validated.split("-");
  const utc = new TZDate(0, "UTC");
  utc.setFullYear(Number(yearText), Number(monthText) - 1, Number(dayText));
  utc.setHours(0, 0, 0, 0);
  return utc;
}

/** Internal DayPicker adapter: native selection back to a calendar date. */
export function utcDateToCalendarDate(value: Date): CalendarDateString {
  const utc =
    value instanceof TZDate && value.timeZone === "UTC"
      ? value
      : new TZDate(value, "UTC");
  const year = String(utc.getFullYear()).padStart(4, "0");
  const month = String(utc.getMonth() + 1).padStart(2, "0");
  const day = String(utc.getDate()).padStart(2, "0");
  return parseCalendarDate(`${year}-${month}-${day}`);
}
