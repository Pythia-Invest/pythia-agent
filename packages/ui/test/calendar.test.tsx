import { TZDate } from "@date-fns/tz";
import { readFile } from "node:fs/promises";
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
    "2024-03-31",
    "2024-10-27",
    "2024-11-03",
    "2025-01-01",
    "0001-01-01",
    "9999-12-31",
  ])("round-trips %s through a UTC TZDate without shifting", (value) => {
    const parsed = parseCalendarDate(value);
    const native = calendarDateToUTCDate(parsed);

    expect(native).toBeInstanceOf(TZDate);
    expect(native.timeZone).toBe("UTC");
    expect(native.getHours()).toBe(0);
    expect(utcDateToCalendarDate(native)).toBe(value);
  });

  it.each([
    "2023-02-29",
    "2024-04-31",
    "2024-13-01",
    "2024-00-10",
    "0000-01-01",
    "2024-1-01",
    "03/10/2024",
    "2024-03-10T00:00:00Z",
  ])("rejects invalid or instant-like value %s", (value) => {
    expect(isCalendarDateString(value)).toBe(false);
    expect(() => parseCalendarDate(value)).toThrow(TypeError);
  });

  it("renders explicit selected/today/month values with DayPicker semantics", () => {
    const html = renderToStaticMarkup(
      <Calendar
        aria-label="Publication date"
        disabledDates={["2024-03-11"]}
        month="2024-03-01"
        today="2024-03-10"
        value="2024-03-10"
      />,
    );

    expect(html).toContain('aria-label="Publication date"');
    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-today="true"');
    expect(html).toContain("March 2024");
    expect(html).toContain("bg-[var(--py-action-primary-background)]");
    expect(html).toContain("text-[var(--py-action-primary-foreground)]");
    expect(html).toContain(
      "[&amp;&gt;button:hover]:bg-[var(--py-action-primary-background)]",
    );
    expect(html).toContain(
      "[&amp;&gt;button:hover]:text-[var(--py-action-primary-foreground)]",
    );
    expect(html).toContain(
      "[&amp;[data-today]]:after:bg-[var(--py-action-primary-foreground)]",
    );
    expect(html).not.toContain("ring-inset");
    expect(html).not.toContain("--py-signal-");
  });

  it("keeps UTC and explicit clock inputs fixed in the DayPicker adapter", async () => {
    const source = await readFile(
      new URL("../src/calendar/calendar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('timeZone="UTC"');
    expect(source).toContain("today={todayDate}");
    expect(source).toContain("defaultMonth={initialMonth}");
    expect(source).not.toContain("new Date(");
    expect(source).not.toContain("Intl.");
  });

  it("disables DayPicker month navigation with the complete calendar", () => {
    const html = renderToStaticMarkup(
      <Calendar
        disabled
        month="2024-03-01"
        today="2024-03-10"
        value="2024-03-10"
      />,
    );
    const previous = html.match(
      /<button[^>]*aria-label="Go to the Previous Month"[^>]*>/,
    )?.[0];
    const next = html.match(
      /<button[^>]*aria-label="Go to the Next Month"[^>]*>/,
    )?.[0];

    expect(previous).toContain('aria-disabled="true"');
    expect(previous).toContain('tabindex="-1"');
    expect(next).toContain('aria-disabled="true"');
    expect(next).toContain('tabindex="-1"');
  });

  it("renders a persistent-label picker trigger without formatting the value", () => {
    const html = renderToStaticMarkup(
      <DatePicker
        description="Calendar date, not an instant."
        label="Report date"
        month="2024-03-01"
        today="2024-03-10"
        value="2024-03-10"
      />,
    );

    expect(html).toContain("Report date");
    expect(html).toContain("Calendar date, not an instant.");
    expect(html).toContain("2024-03-10");
    expect(html).toContain('aria-label="Report date: 2024-03-10"');
    expect(html).not.toContain("3/10/2024");
  });

  it("validates a closed DatePicker boundary before its portal opens", () => {
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
