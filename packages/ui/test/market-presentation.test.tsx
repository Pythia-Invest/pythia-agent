import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  InstrumentChange,
  InstrumentIdentity,
  InstrumentPrice,
} from "../src/market-widgets/values";
import { InstrumentExtendedSummary } from "../src/market-widgets/extended-change";
import { InstrumentPathView } from "../src/market-widgets/instrument-path";
import { InstrumentSparkline } from "../src/market-widgets/sparkline";
import type { InstrumentDisplay } from "../src/market-widgets/types";

const item: InstrumentDisplay = {
  id: "synthetic:one",
  ticker: "ONE",
  name: "Synthetic One",
  price: 42.5,
  status: "live",
  statusLabel: "Synthetic live quote",
  description: "Synthetic provider · USD · test timestamp",
  change: { percent: 2, basis: "Since the synthetic previous close" },
  path: {
    label: "Synthetic session price history",
    baseline: { label: "Synthetic previous close", value: 42 },
    session: { start: 0, end: 600 },
    points: [
      { time: 0, value: 41 },
      { time: 60, value: 43 },
    ],
  },
};

test.each([
  { status: "unavailable" as const },
  {
    status: "live" as const,
    activity: { session: "open" as const, data: "unavailable" as const },
  },
])(
  "unavailable inputs cannot leak a retained price, change, or chart: %j",
  (state) => {
    const unavailable: InstrumentDisplay = {
      ...item,
      ...state,
      extended: {
        label: "Post",
        price: 43,
        absolute: 0.5,
        percent: 1.18,
        time: "2026-01-02T22:00:00Z",
      },
    };
    const html = renderToStaticMarkup(
      <>
        <InstrumentPrice item={unavailable} />
        <InstrumentChange item={unavailable} />
        <InstrumentExtendedSummary item={unavailable} />
        <InstrumentPathView item={unavailable} />
      </>,
    );
    expect(html).not.toContain("42.50");
    expect(html).not.toContain("+2.00%");
    expect(html).not.toContain("+1.18%");
    expect(html).not.toContain('data-slot="instrument-sparkline"');
    expect(html).toContain('aria-label="Price history unavailable"');
  },
);

test("explicitly stale authorized inputs remain visible without an animated chart tail", () => {
  const stale: InstrumentDisplay = {
    ...item,
    activity: { session: "open", data: "stale" },
    extended: {
      label: "Post",
      price: 43,
      absolute: 0.5,
      percent: 1.18,
      time: "2026-01-02T22:00:00Z",
    },
  };
  const html = renderToStaticMarkup(
    <>
      <InstrumentPrice item={stale} />
      <InstrumentChange item={stale} />
      <InstrumentExtendedSummary item={stale} />
      <InstrumentPathView item={stale} />
    </>,
  );
  expect(html).toContain("42.50");
  expect(html).toContain("+2.00%");
  expect(html).toContain("+1.18%");
  expect(html).toContain('data-slot="instrument-sparkline"');
  expect(html).not.toContain('data-slot="instrument-path-tail"');
});

test("closed market activity does not discard the completed extended-session change", () => {
  const closed: InstrumentDisplay = {
    ...item,
    status: "closed",
    activity: { session: "closed", data: "snapshot" },
    extended: {
      label: "Post",
      price: 43,
      absolute: 0.5,
      percent: 1.18,
      time: "2026-01-02T22:00:00Z",
    },
  };
  const html = renderToStaticMarkup(
    <>
      <InstrumentIdentity item={closed} />
      <InstrumentPrice item={closed} />
      <InstrumentExtendedSummary item={closed} />
    </>,
  );
  expect(html).toContain("42.50");
  expect(html).toContain("+1.18%");
  expect(html).toContain('aria-label="Market closed"');
  expect(html).toContain("+0.50");
});

test("loading status controls stay absent while independently loading history has a textual state", () => {
  const loading = renderToStaticMarkup(
    <InstrumentIdentity item={item} loading />,
  );
  expect(loading).not.toContain('data-slot="instrument-status"');
  expect(loading).not.toContain('data-slot="instrument-note"');
  expect(loading).toContain("ONE");
  const html = renderToStaticMarkup(
    <>
      <InstrumentPrice item={item} />
      <InstrumentPathView
        item={{ ...item, path: undefined, pathState: "loading" }}
      />
    </>,
  );
  expect(html).toContain("42.50");
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-label="Loading price history"');
});

test("non-price units and change baselines survive compact formatting", () => {
  const yieldItem: InstrumentDisplay = {
    ...item,
    price: 4.062,
    precision: 3,
    priceSuffix: "%",
    change: {
      absolute: 2.4,
      unit: "bp",
      basis: "Since the synthetic previous close",
    },
  };
  const html = renderToStaticMarkup(
    <>
      <InstrumentPrice item={yieldItem} />
      <InstrumentChange item={yieldItem} />
    </>,
  );
  expect(html).toContain("4.062");
  expect(html).toContain("+2.4 bp");
  expect(html).not.toContain("+2.40%");
  expect(html).toContain('title="Since the synthetic previous close"');
});

test("path descriptions retain the supplied baseline or its absence", () => {
  if (!item.path) throw new Error("The synthetic fixture requires a path");
  const html = renderToStaticMarkup(<InstrumentSparkline series={item.path} />);
  expect(html).toContain('role="img"');
  expect(html).toContain(
    'aria-label="Synthetic session price history · baseline: Synthetic previous close"',
  );
  expect(
    renderToStaticMarkup(
      <InstrumentSparkline series={{ ...item.path, baseline: undefined }} />,
    ),
  ).toContain("no comparable baseline");
});
