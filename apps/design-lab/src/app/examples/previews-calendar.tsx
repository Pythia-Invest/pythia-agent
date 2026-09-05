"use client";

import { Calendar, DatePicker, type CalendarDateString } from "@pythia/ui";
import { useState } from "react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

const month = "2028-04-01" as CalendarDateString;
const today = "2028-04-12" as CalendarDateString;
const disabledDates = [
  "2028-04-06",
  "2028-04-20",
] as const satisfies readonly CalendarDateString[];

export function CalendarPreview({ route }: { route: CatalogRoute }) {
  const [value, setValue] = useState<CalendarDateString | undefined>(
    "2028-04-14",
  );

  switch (route) {
    case "/components/calendar":
      return (
        <SpecimenGrid>
          <Specimen label="Single calendar-date selection">
            <Calendar
              aria-label="Choose a synthetic review date"
              disabledDates={disabledDates}
              month={month}
              onValueChange={setValue}
              today={today}
              value={value}
            />
            <DemoNote>
              Selected calendar date: {value ?? "none"}. Dates are fixed
              synthetic values.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/date-picker":
      return (
        <SpecimenGrid>
          <Specimen label="Labelled popover date picker">
            <div className="catalog-date-picker">
              <DatePicker
                description="Fixed synthetic schedule; no ambient clock."
                disabledDates={disabledDates}
                label="Synthetic review date"
                month={month}
                onValueChange={setValue}
                today={today}
                value={value}
              />
            </div>
            <DemoNote>Selected calendar date: {value ?? "none"}.</DemoNote>
          </Specimen>
          <Specimen label="Empty and error presentation">
            <div className="catalog-date-picker">
              <DatePicker
                error="Choose a synthetic calendar date."
                label="Synthetic evidence date"
                month={month}
                onValueChange={() => undefined}
                today={today}
              />
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated calendar preview: ${route}`);
  }
}
