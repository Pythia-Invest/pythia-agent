import { expect, test } from "vitest";
import { formatTimestamp } from "../src/client/local-time";
test("viewer timezone determines the calendar day; date-only sessions are never shifted", () => {
  const instant = "2026-01-02T00:30:00Z";
  expect(
    formatTimestamp(instant, "full", "America/Los_Angeles", "en-GB"),
  ).toContain("01/01/2026, 16:30:00");
  expect(formatTimestamp(instant, "full", "Asia/Tokyo", "en-GB")).toContain(
    "02/01/2026, 09:30:00",
  );
  expect(formatTimestamp("2026-01-02", "full", "America/Los_Angeles")).toBe(
    "2026-01-02",
  );
  expect(formatTimestamp(instant, "full", null)).toBe("…");
});
test("daylight-saving transitions, offsets and numeric instants remain correct", () => {
  const time = (value: string | number) =>
    formatTimestamp(value, "full", "Europe/Brussels", "en-GB");
  expect(time("2026-03-29T00:30:00Z")).toContain("01:30:00");
  expect(time("2026-03-29T01:30:00Z")).toContain("03:30:00");
  expect(time("2026-03-29T03:30:00+02:00")).toBe(time("2026-03-29T01:30:00Z"));
  expect(time(Date.parse("2026-03-29T01:30:00Z"))).toBe(
    time("2026-03-29T01:30:00Z"),
  );
  for (const value of [
    null,
    undefined,
    "bad",
    "2026-01-02T15:00:00",
    Number.NaN,
  ])
    expect(formatTimestamp(value, "full", "Europe/Brussels")).toBe(
      "Time unknown",
    );
});
