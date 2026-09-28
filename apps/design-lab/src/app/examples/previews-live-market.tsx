"use client";
import {
  InstrumentChart,
  type InstrumentDisplay,
  InstrumentStats,
  OrderBookLadder,
  type OrderBookDisplay,
  type TradeDisplay,
  TradeTape,
} from "@pythia/ui";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

// Synthetic values only: an invented perp around 100.
const now = Date.UTC(2028, 3, 12, 9, 30, 0);
const book: OrderBookDisplay = {
  bids: [
    { price: "100.0", size: "4.2", orders: 9 },
    { price: "99.9", size: "0.75", orders: 2 },
    { price: "99.8", size: "12.5", orders: 14 },
    { price: "99.7", size: "1.1", orders: 3 },
    { price: "99.5", size: "6", orders: 5 },
  ],
  asks: [
    { price: "100.1", size: "0.4", orders: 1 },
    { price: "100.2", size: "2.35", orders: 4 },
    { price: "100.3", size: "8", orders: 6 },
    { price: "100.5", size: "3.9", orders: 3 },
    { price: "100.6", size: "15", orders: 11 },
  ],
  precision: 1,
  unit: "SYN",
  label: "Synthetic top 5 levels",
};
const trades: TradeDisplay[] = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  time: now - i * 2_300,
  price: (100.05 + Math.sin(i) * 0.1).toFixed(1),
  size: (0.05 + (i % 4) * 0.3).toFixed(2),
  side: i % 3 === 0 ? "sell" : "buy",
}));
const line: InstrumentDisplay = {
  id: "synthetic-live",
  ticker: "Mark price",
  price: 100.05,
  precision: 1,
  status: "live",
  activity: { session: "continuous", data: "current" },
  statusLabel: "Real time",
  description: "Synthetic live market",
  path: {
    live: true,
    label: "Last trade, past 15 minutes",
    intervalMs: 60_000,
    window: { start: now - 900_000, end: now },
    points: Array.from({ length: 120 }, (_, i) => ({
      time: now - 900_000 + i * 7_000 + 500,
      value: 100 + Math.sin(i / 9) * 0.4 + (i % 5) * 0.02,
    })),
  },
};

/** The live market view's reusable parts on synthetic data. */
export function LiveMarketPreview() {
  return (
    <SpecimenGrid>
      <div className="col-span-full">
        <Specimen label="Rolling 15-minute line with minute labels">
          <div className="w-full max-w-3xl">
            <InstrumentChart item={line} height={220} />
          </div>
        </Specimen>
      </div>
      <Specimen label="Order book ladder · asks above the spread, cumulative depth">
        <div className="w-72">
          <OrderBookLadder book={book} />
        </div>
      </Specimen>
      <Specimen label="Trade tape · newest first, aggressor side">
        <div className="w-72">
          <TradeTape trades={trades} precision={1} unit="SYN" dropped={3} />
        </div>
      </Specimen>
      <Specimen label="Empty book (a halted or delisted market)">
        <div className="w-72">
          <OrderBookLadder book={{ ...book, bids: [], asks: [] }} />
        </div>
      </Specimen>
      <div className="col-span-full">
        <Specimen label="Context strip · rates in percent, sizes with a unit">
          <InstrumentStats
            precision={1}
            stats={[
              {
                id: "oracle",
                label: "Oracle",
                value: 100.02,
                detail: "Synthetic",
              },
              {
                id: "funding",
                label: "Funding · 1h",
                value: 0.00125,
                format: "percent",
                detail: "Synthetic hourly rate",
              },
              {
                id: "oi",
                label: "Open interest",
                value: 36_850.9,
                format: "quantity",
                unit: "SYN",
                detail: "Synthetic",
              },
            ]}
          />
          <DemoNote>
            Values are invented. The page dims these parts and stops the tail
            dot when updates pause.
          </DemoNote>
        </Specimen>
      </div>
    </SpecimenGrid>
  );
}
