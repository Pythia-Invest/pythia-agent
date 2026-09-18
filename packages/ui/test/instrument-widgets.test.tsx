import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  InstrumentTile,
  InstrumentCompactTile,
  InstrumentTable,
  type InstrumentDisplay,
} from "../src/market-widgets";
const item: InstrumentDisplay = {
  id: "synthetic:one",
  ticker: "ONE",
  name: "Synthetic One",
  price: 42.5,
  status: "live",
  statusLabel: "Synthetic live quote",
  description: "Synthetic provider · USD · test timestamp",
  change: { percent: 2 },
  path: {
    label: "Synthetic price path",
    baseline: { label: "Same-feed previous close", value: 42 },
    intervalMs: 60,
    points: [
      { time: 0, value: 41 },
      { time: 60, value: 43 },
      { time: 240, value: 41 },
    ],
  },
};

test.each([
  { status: "unavailable" as const },
  {
    status: "live" as const,
    activity: { session: "open" as const, data: "unavailable" as const },
  },
])("unavailable prices cannot leak through any widget: %j", (state) => {
  const unavailable = {
    ...item,
    ...state,
    statusLabel: "Unavailable",
    note: "No data",
    extended: {
      label: "Post",
      price: 43.21,
      percent: 3.21,
      time: "2026-01-02T22:00:00Z",
    },
    ohl: { open: 43.31, high: 43.41, low: 43.11 },
    book: {
      bid: 43.51,
      ask: 43.61,
      bidSize: 1,
      askSize: 2,
      label: "Synthetic retained book",
    },
  };
  for (const html of [
    renderToStaticMarkup(<InstrumentTile item={unavailable} />),
    renderToStaticMarkup(<InstrumentCompactTile item={unavailable} />),
    renderToStaticMarkup(
      <InstrumentTable read={{ rows: [unavailable], state: "ready" }} />,
    ),
  ]) {
    expect(html).not.toContain("42.50");
    expect(html).not.toContain("+2.00%");
    expect(html).not.toContain("43.21");
    expect(html).not.toContain("43.31");
    expect(html).not.toContain("43.51");
    expect(html).not.toContain('data-slot="instrument-sparkline"');
  }
});
test("dense views preserve closed-session extended change and suppress loading status controls", () => {
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
  for (const html of [
    renderToStaticMarkup(<InstrumentCompactTile item={closed} />),
    renderToStaticMarkup(
      <InstrumentTable read={{ state: "ready", rows: [closed] }} />,
    ),
  ]) {
    expect(html).toContain("42.50");
    expect(html).toContain("+1.18%");
    expect(html).toContain('aria-label="Market closed"');
  }
  for (const html of [
    renderToStaticMarkup(<InstrumentCompactTile item={closed} loading />),
    renderToStaticMarkup(
      <InstrumentTable read={{ state: "loading", rows: [closed] }} />,
    ),
  ]) {
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('data-slot="instrument-status"');
    expect(html).not.toContain('data-slot="instrument-note"');
    expect(html).toContain("ONE");
  }
});
test("extended quotes stay subordinate; compact tiles omit paths; units do not become percent returns", () => {
  const html = renderToStaticMarkup(
    <InstrumentTile
      item={{
        ...item,
        status: "extended",
        note: "Close Fri",
        extended: { label: "Pre", price: 43.75, time: "07:42" },
      }}
    />,
  );
  expect(html).toContain("42.50");
  expect(html).toContain("43.75");
  expect(
    renderToStaticMarkup(
      <InstrumentTile item={item} options={{ compact: true }} />,
    ),
  ).not.toContain('data-slot="instrument-sparkline"');
  const yieldHtml = renderToStaticMarkup(
    <InstrumentTile
      item={{
        ...item,
        price: 4.062,
        precision: 3,
        priceSuffix: "%",
        change: { absolute: 2.4, unit: "bp" },
      }}
    />,
  );
  expect(yieldHtml).toContain("4.062");
  expect(yieldHtml).toContain("+2.4 bp");
  expect(yieldHtml).not.toContain("+2.40%");
});
test("loading, empty, error and market activity have textual equivalents and inspectable details", () => {
  for (const state of ["loading", "empty", "error"] as const)
    expect(
      renderToStaticMarkup(<InstrumentTable read={{ rows: [], state }} />),
    ).toContain('role="status"');
  const html = renderToStaticMarkup(
    <InstrumentTile item={{ ...item, note: "Live" }} />,
  );
  expect(html).toContain('aria-label="Market open"');
  expect(html).not.toContain('aria-haspopup="dialog"');
  expect(
    renderToStaticMarkup(
      <InstrumentTile
        item={{
          ...item,
          activity: { session: "continuous", data: "snapshot", period: "24h" },
        }}
      />,
    ),
  ).toContain("24h");
});

test("loading withholds optional tile values while preserving their sections", () => {
  const complete: InstrumentDisplay = {
    ...item,
    extended: {
      label: "Post",
      price: 43.21,
      percent: 1.67,
      time: "2026-01-02T22:00:00Z",
    },
    ohl: { open: 42.31, high: 43.41, low: 41.11 },
    book: {
      bid: 43.51,
      ask: 43.61,
      bidSize: 10,
      askSize: 20,
      label: "Synthetic retained book",
    },
  };
  const loading = renderToStaticMarkup(
    <InstrumentTile
      item={complete}
      options={{ range: true, book: true }}
      loading
    />,
  );
  const ready = renderToStaticMarkup(
    <InstrumentTile item={complete} options={{ range: true, book: true }} />,
  );
  expect(loading).toContain('aria-busy="true"');
  for (const section of ["extended", "range", "book"]) {
    expect(loading).toMatch(
      new RegExp(
        `data-slot="instrument-${section}"[^>]*aria-hidden="true"`,
        "u",
      ),
    );
    expect(ready).toContain(`data-slot="instrument-${section}"`);
    expect(ready).not.toMatch(
      new RegExp(
        `data-slot="instrument-${section}"[^>]*aria-hidden="true"`,
        "u",
      ),
    );
  }
  for (const value of ["43.21", "43.41", "41.11", "43.51", "43.61"])
    expect(ready).toContain(value);
});

test("table actions receive only supplied identities, never loading placeholders", () => {
  const called: InstrumentDisplay[] = [];
  const action = (row: InstrumentDisplay) => {
    called.push(row);
    return <button type="button">Open {row.ticker}</button>;
  };
  const skeleton = renderToStaticMarkup(
    <InstrumentTable read={{ state: "loading", rows: [] }} action={action} />,
  );
  expect(called).toEqual([]);
  expect(skeleton).not.toContain("<button");
  const known = renderToStaticMarkup(
    <InstrumentTable
      read={{ state: "loading", rows: [item] }}
      action={action}
    />,
  );
  expect(called).toEqual([item]);
  expect(known).toContain("Open ONE");
});

test("tile-only compact settings do not duplicate names in tables", () => {
  const html = renderToStaticMarkup(
    <InstrumentTable
      read={{ rows: [item], state: "ready" }}
      options={{ compact: true, name: true }}
    />,
  );
  expect(html.match(/>Synthetic One</gu)).toHaveLength(1);
});
