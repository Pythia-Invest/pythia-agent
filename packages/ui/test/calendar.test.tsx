import { TZDate } from "@date-fns/tz";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Calendar } from "../src/calendar/calendar";
import {
  calendarDateToUTCDate,
  isCalendarDateString,
  parseCalendarDate,
  utcDateToCalendarDate,
} from "../src/calendar/calendar-date";
import { DatePicker } from "../src/calendar/date-picker";

describe("calendar-date boundary", () => {
  it.each([
    "2024-02-29",
    "2024-03-10",
    "2024-10-27",
    "2024-11-03",
    "0001-01-01",
    "9999-12-31",
  ])("round-trips %s through UTC without shifting", (value) => {
    const native = calendarDateToUTCDate(parseCalendarDate(value));
    expect(native).toBeInstanceOf(TZDate);
    expect(native.timeZone).toBe("UTC");
    expect(native.getHours()).toBe(0);
    expect(utcDateToCalendarDate(native)).toBe(value);
  });

  it.each([
    "2023-02-29",
    "2024-04-31",
    "2024-13-01",
    "0000-01-01",
    "03/10/2024",
    "2024-03-10T00:00:00Z",
  ])("rejects invalid or instant-like value %s", (value) => {
    expect(isCalendarDateString(value)).toBe(false);
    expect(() => parseCalendarDate(value)).toThrow(TypeError);
  });

  it("renders supplied selection and current-day semantics", () => {
    const html = renderToStaticMarkup(
      <Calendar
        aria-label="Publication date"
        month="2024-03-01"
        today="2024-03-10"
        value="2024-03-10"
      />,
    );
    expect(html).toContain('aria-label="Publication date"');
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-today="true"');
  });

  it("disables both month-navigation actions", () => {
    const html = renderToStaticMarkup(
      <Calendar disabled month="2024-03-01" today="2024-03-10" />,
    );
    const previous = html.match(
      /<button[^>]*aria-label="Go to the Previous Month"[^>]*>/u,
    )?.[0];
    const next = html.match(
      /<button[^>]*aria-label="Go to the Next Month"[^>]*>/u,
    )?.[0];
    expect(previous).toContain('aria-disabled="true"');
    expect(previous).toContain('tabindex="-1"');
    expect(next).toContain('aria-disabled="true"');
    expect(next).toContain('tabindex="-1"');
  });

  it("keeps the calendar date unformatted in the labelled trigger", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        label="Report date"
        month="2024-03-01"
        today="2024-03-10"
        value="2024-03-10"
      />,
    );
    expect(html).toContain("2024-03-10");
    expect(html).toContain('aria-label="Report date: 2024-03-10"');
    expect(html).not.toContain("3/10/2024");
  });

  it("rejects an invalid picker boundary before opening its portal", () => {
    expect(() =>
      renderToStaticMarkup(
        <DatePicker
          label="Report date"
          month="2024-02-31"
          today="2024-03-10"
        />,
      ),
    ).toThrow("expected a real YYYY-MM-DD date");
  });
});
