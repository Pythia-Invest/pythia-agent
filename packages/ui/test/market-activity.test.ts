import { expect, test } from "vitest";
import {
  activitySummary,
  instrumentPathActive,
} from "../src/market-widgets/activity";
import type { InstrumentDisplay } from "../src/market-widgets/types";
test("data warnings outrank period labels without changing market activity", () => {
  expect(
    activitySummary({ session: "continuous", data: "snapshot", period: "7d" }),
  ).toBe("7d");
  expect(
    activitySummary({ session: "continuous", data: "stale", period: "7d" }),
  ).toBe("Stale");
  expect(
    activitySummary({ session: "open", data: "delayed", delayMinutes: 15 }),
  ).toBe("15m delay");
  expect(
    activitySummary({ session: "open", data: "delayed", delayMinutes: 1000 }),
  ).toBe("Delayed");
  expect(activitySummary({ session: "closed", data: "snapshot" })).toBe(
    "Closed",
  );
  const row: InstrumentDisplay = {
    id: "test",
    ticker: "TEST",
    price: 1,
    status: "unknown",
    statusLabel: "Test",
    description: "Synthetic",
    activity: { session: "continuous", data: "snapshot" },
  };
  expect(instrumentPathActive(row)).toBe(true);
  expect(
    instrumentPathActive({
      ...row,
      activity: { session: "continuous", data: "stale" },
    }),
  ).toBe(false);
  expect(
    instrumentPathActive({
      ...row,
      activity: { session: "closed", data: "snapshot" },
    }),
  ).toBe(false);
});
