import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const interactiveEntries = [
  "../src/actions/button.tsx",
  "../src/actions/toggle.tsx",
  "../src/forms/field.tsx",
  "../src/forms/otp-field.tsx",
  "../src/calendar/calendar.tsx",
  "../src/calendar/date-picker.tsx",
] as const;

const serverCompatibleEntries = [
  "../src/actions/index.ts",
  "../src/forms/index.ts",
  "../src/calendar/index.ts",
  "../src/calendar/calendar-date.ts",
] as const;

describe("client boundaries", () => {
  it.each(interactiveEntries)(
    "marks %s as a narrow client entry",
    async (path) => {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source.startsWith('"use client";')).toBe(true);
    },
  );

  it.each(serverCompatibleEntries)(
    "keeps %s free of a module-wide client directive",
    async (path) => {
      const source = await readFile(new URL(path, import.meta.url), "utf8");
      expect(source.startsWith('"use client";')).toBe(false);
    },
  );
});
