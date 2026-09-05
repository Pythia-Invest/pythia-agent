import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFile(new URL(path, import.meta.url), "utf8");

describe("uniform disabled presentation", () => {
  it("owns one profile- and theme-independent disabled opacity token", async () => {
    const styles = await source("../src/styles.css");

    expect(styles.match(/--py-disabled-opacity:/g)).toHaveLength(1);
    expect(styles).toContain("--py-disabled-opacity: 0.55;");
    expect(styles.indexOf("--py-disabled-opacity")).toBeLessThan(
      styles.indexOf(':root,\n[data-theme="light"]'),
    );
  });

  it("uses the semantic opacity across every existing owned disabled recipe", async () => {
    const files = await Promise.all(
      [
        "../src/actions/button.tsx",
        "../src/actions/toggle.tsx",
        "../src/forms/forms.css",
        "../src/calendar/calendar.tsx",
        "../src/selection/selection.css",
        "../src/navigation/navigation.css",
        "../src/overlays/overlays.css",
        "../src/disclosure/disclosure.css",
      ].map(source),
    );

    for (const file of files) {
      expect(file).toContain("var(--py-disabled-opacity)");
    }

    const disabledSources = files.join("\n");
    expect(disabledSources).not.toMatch(/disabled:opacity-(?:45|55|72|75)/);
    expect(disabledSources).not.toMatch(/opacity:\s*0\.(?:45|55|72|75)/);
    expect(disabledSources).not.toMatch(
      /disabled:(?:bg-\[var\(--py-surface-subtle\)\]|text-\[var\(--py-text-disabled\)\])/,
    );
  });

  it("fades field-owned content once and keeps outside-month dates separate", async () => {
    const [forms, field, otp, datePicker, calendar] = await Promise.all([
      source("../src/forms/forms.css"),
      source("../src/forms/field.tsx"),
      source("../src/forms/otp-field.tsx"),
      source("../src/calendar/date-picker.tsx"),
      source("../src/calendar/calendar.tsx"),
    ]);

    expect(forms).toMatch(
      /\.py-field\[data-disabled\]\s*\{[^}]*opacity:\s*var\(--py-disabled-opacity\)/,
    );
    expect(forms).toMatch(
      /\.py-field\[data-disabled\] \.py-field-control:disabled\s*\{[^}]*opacity:\s*1/,
    );
    expect(field).toContain("py-field grid");
    expect(otp).toContain("py-field grid");
    expect(datePicker).toContain('data-disabled={disabled ? "" : undefined}');
    expect(calendar).toContain(
      '[DayFlag.outside]: "text-[var(--py-text-disabled)] opacity-55"',
    );
    expect(calendar).toContain("opacity-[var(--py-disabled-opacity)]`,");
  });
});
