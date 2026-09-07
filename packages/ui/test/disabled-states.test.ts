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
        "../src/forms/field.tsx",
        "../src/calendar/calendar.tsx",
        "../src/selection/checkbox.tsx",
        "../src/selection/select.tsx",
        "../src/selection/shared.ts",
        "../src/navigation/tabs.tsx",
        "../src/overlays/menu.tsx",
        "../src/disclosure/accordion.tsx",
        "../src/disclosure/collapsible.tsx",
      ].map(source),
    );

    for (const file of files) {
      expect(file).toContain("opacity-disabled");
    }

    const disabledSources = files.join("\n");
    expect(disabledSources).not.toMatch(/disabled:opacity-(?:45|55|72|75)/);
    expect(disabledSources).not.toMatch(/opacity-\[/);
    expect(disabledSources).not.toMatch(
      /disabled:(?:bg-subtle|text-foreground-disabled)/,
    );
  });

  it("fades field-owned content once and keeps outside-month dates separate", async () => {
    const [field, otp, datePicker, calendar] = await Promise.all([
      source("../src/forms/field.tsx"),
      source("../src/forms/otp-field.tsx"),
      source("../src/calendar/date-picker.tsx"),
      source("../src/calendar/calendar.tsx"),
    ]);

    // The field root fades once; a disabled control inside it stays at full opacity.
    expect(field).toContain("data-disabled:opacity-disabled");
    expect(field).toContain("group-data-disabled:disabled:opacity-100");
    expect(otp).toContain("fieldClasses.root");
    expect(otp).toContain("group-data-disabled:disabled:opacity-100");
    expect(datePicker).toContain("fieldClasses.root");
    expect(datePicker).toContain('data-disabled={disabled ? "" : undefined}');
    expect(calendar).toContain(
      '[DayFlag.outside]: "text-foreground-disabled opacity-55"',
    );
    expect(calendar).toContain("opacity-disabled`,");
  });
});
