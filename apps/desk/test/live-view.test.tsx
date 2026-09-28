import type { LiveMarket } from "@pythia/market-data/live";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pageBlocks } from "@/components/instrument/blocks";
import { LiveMarketPanel } from "@/components/instrument/live-view";

const now = Date.UTC(2026, 8, 28, 12, 0, 0);
const market: LiveMarket = {
  schema_version: 1,
  subject: { subject_id: "market:pythia:synthetic-perp" },
  source: {
    plugin: "pythia-synthetic",
    venue: "synthetic",
    scope: "venue",
    market_data_type: "realtime",
  },
  book: {
    time: now - 200,
    depth: "snapshot",
    unit: { kind: "coin", code: "SYN" },
    bids: [["100.0", "2", 3]],
    asks: [["100.5", "1", 1]],
  },
  trades: { items: [[now - 1000, "100.5", "0.1", "buy"]], dropped: 0 },
  line: {
    measure: "last_trade",
    bucket_ms: 1000,
    points: [
      [now - 600_000, "99.0"],
      [now - 1000, "100.5"],
    ],
    seeded_from: "candle_1m",
  },
  context: {
    kind: "perp",
    time: now - 100,
    mark: "100.2",
    oracle: "100.1",
    funding: { rate_1h: "0.0000125", next_time: now + 1_800_000 },
    open_interest: "1000.5",
    prev_day: "99.0",
  },
  gaps: [],
  issues: [],
  retrieved_at: now - 50,
};

function render(value: LiveMarket, stale = false) {
  return renderToStaticMarkup(
    <LiveMarketPanel
      market={value}
      label="Synthetic"
      stale={stale}
      now={now}
    />,
  );
}

describe("live market section", () => {
  it("is its own block after the chart", () => {
    const blocks = pageBlocks([
      {
        section: "live",
        plugin: "pythia-synthetic",
        label: "Synthetic",
        status: "ready",
        binding: null,
        request: null,
        alternatives: [],
        reason: null,
      },
    ]);
    expect(blocks.map((block) => [block.type, block.title])).toEqual([
      ["live", "Live"],
    ]);
  });

  it("leads with the mark and its 24h change, then the perp context", () => {
    const html = render(market);
    expect(html).toContain("Mark price");
    expect(html).toContain("24h");
    expect(html).toContain("Funding · 1h");
    expect(html).toContain("+0.00125%");
    expect(html).toContain("SYN");
    expect(html).not.toContain("are paused");
  });

  it("never looks live while stale and names interruptions and drift", () => {
    const html = render(
      {
        ...market,
        gaps: [{ start: now - 60_000, end: now - 48_000 }],
        issues: [{ code: "source_drift", severity: "warning", message: "x" }],
      },
      true,
    );
    expect(html).toContain("Updates from Synthetic are paused");
    expect(html).toContain("for 12 s");
    expect(html).toContain("unexpected shape");
    expect(html).toContain("opacity-70");
  });

  it("labels a single-venue feed on an instrument's page", () => {
    const html = render({
      ...market,
      subject: { subject_id: "listing:isin:XS0000000000:XNAS:USD" },
      context: {
        kind: "equity_session",
        time: now,
        session: "regular",
      },
    });
    expect(html).toContain("(synthetic only)");
    expect(html).toContain("Last trade");
  });
});
