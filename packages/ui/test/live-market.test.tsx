import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstrumentChart } from "../src/market-widgets/instrument-chart";
import {
  decimalText,
  OrderBookLadder,
  TradeTape,
} from "../src/market-widgets/live-market";

const book = {
  bids: [
    { price: "100.0", size: "2", orders: 3 },
    { price: "99.5", size: "1.25" },
  ],
  asks: [
    { price: "100.5", size: "1" },
    { price: "101.0", size: "3" },
  ],
  precision: 1,
  unit: "SYN",
  label: "Synthetic book",
};

describe("live market presentation", () => {
  it("lists asks above the spread and bids below, with cumulative size", () => {
    const html = renderToStaticMarkup(<OrderBookLadder book={book} />);
    const order = ["101.0", "100.5", "Spread 0.5 (0.500%)", "100.0", "99.5"];
    const positions = order.map((text) => html.indexOf(`>${text}<`));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain("3.25"); // bid total, in the sizes' own precision
    expect(html).toContain('aria-label="Bids"');
    expect(html).toContain("Size (SYN)");
  });

  it("says when the book is empty instead of drawing nothing", () => {
    const html = renderToStaticMarkup(
      <OrderBookLadder book={{ ...book, bids: [], asks: [] }} />,
    );
    expect(html).toContain("No orders in the book.");
  });

  it("shows the tape as given, sides in words as well as color", () => {
    const html = renderToStaticMarkup(
      <TradeTape
        trades={[
          { id: "b", time: 2, price: "100.5", size: "0.10", side: "buy" },
          { id: "a", time: 1, price: "100.0", size: "1", side: null },
        ]}
        precision={1}
        dropped={4}
      />,
    );
    expect(html.indexOf("Buy ")).toBeLessThan(html.indexOf("100.0"));
    expect(html).toContain('data-side="unknown"');
    expect(html).toContain("4 more trades arrived between updates");
  });

  it("formats decimal text exactly", () => {
    expect(decimalText("83036.0")).toBe("83,036");
    expect(decimalText("0.00195")).toBe("0.00195");
    expect(decimalText("-1234567.50")).toBe("-1,234,567.5");
  });

  it("labels a 15-minute window in minutes", () => {
    const end = Date.UTC(2026, 8, 28, 12, 7, 30);
    const html = renderToStaticMarkup(
      <InstrumentChart
        item={{
          id: "live",
          ticker: "SYN",
          price: 101,
          status: "live",
          statusLabel: "Real time",
          description: "Synthetic",
          path: {
            label: "Last trade",
            live: true,
            points: [
              { time: end - 600_000, value: 100 },
              { time: end - 1000, value: 101 },
            ],
            window: { start: end - 900_000, end },
          },
        }}
      />,
    );
    // Hourly labels alone would leave a 15-minute axis nearly bare.
    expect(html.match(/>\d{2}:\d{2}</g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
