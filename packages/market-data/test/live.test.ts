import { describe, expect, it } from "vitest";
import { parseLiveMarket } from "../src/live";

/** Synthetic snapshots in core's live_market v1 shape
 * (runtime/managed/core/identity/live_market.py). */
const perp = {
  schema_version: 1,
  subject: { subject_id: "market:pythia:synthetic-perp" },
  source: {
    plugin: "pythia-synthetic",
    venue: "synthetic",
    scope: "venue",
    market_data_type: "realtime",
    delay_seconds: 0,
  },
  book: {
    time: 1_790_000_000_250,
    depth: "snapshot",
    unit: { kind: "coin", code: "SYN" },
    bids: [["100.0", "2", 3]],
    asks: [["100.5", "1", 1]],
  },
  trades: { items: [[1_790_000_000_100, "100.5", "0.1", "buy"]], dropped: 0 },
  line: {
    measure: "last_trade",
    bucket_ms: 1000,
    points: [[1_790_000_000_100, "100.5"]],
  },
  context: {
    kind: "perp",
    time: 1_790_000_000_300,
    mark: "100.2",
    funding: { rate_1h: "-0.0000125", next_time: 1_790_003_600_000 },
  },
  gaps: [],
  issues: [],
  retrieved_at: 1_790_000_000_400,
};
const stock = {
  ...perp,
  subject: { subject_id: "listing:isin:XS0000000000:XNAS:USD" },
  book: {
    time: 1_790_000_000_000,
    depth: "top",
    unit: { kind: "shares" },
    bids: [["10.01", "300"]],
    asks: [["10.02", "200"]],
  },
  trades: { items: [[1_790_000_000_000, "10.015", "100", null]], dropped: 3 },
  context: {
    kind: "equity_session",
    time: 1_790_000_000_000,
    session: "regular",
    venue_status: "trading",
  },
};
const envelope = (data: unknown) => ({
  schema_version: 1,
  outcome: "ok",
  data,
  issues: [],
});

describe("live_market decoding", () => {
  it("decodes a perp book and a single-venue stock feed alike", () => {
    expect(parseLiveMarket(envelope(perp)).context?.kind).toBe("perp");
    const decoded = parseLiveMarket(envelope(stock));
    expect(decoded.trades?.items[0]?.[3]).toBeNull();
    expect(decoded.book?.bids[0]).toEqual(["10.01", "300"]);
  });

  it("keeps prices as the source's decimal text and rejects numbers", () => {
    const changed = { ...perp, book: { ...perp.book, bids: [[100, "2"]] } };
    expect(() => parseLiveMarket(envelope(changed))).toThrow();
  });

  it("surfaces an error answer's message", () => {
    expect(() =>
      parseLiveMarket({
        schema_version: 1,
        outcome: "error",
        data: null,
        issues: [{ code: "timeout", message: "No snapshot: timeout." }],
      }),
    ).toThrow("No snapshot: timeout.");
  });
});
