import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { InstrumentChart } from "../src/market-widgets/instrument-chart";

const DAY = 86_400_000;

test("a month that begins on a weekend keeps its label where trading resumes", () => {
  // Weekday closes from 1 Jun to 29 Aug 2026; 1 Aug is a Saturday.
  const points = Array.from(
    { length: 90 },
    (_, i) => Date.UTC(2026, 5, 1) + i * DAY,
  )
    .filter((time) => ![0, 6].includes(new Date(time).getUTCDay()))
    .map((time, i) => ({ time, value: 100 + i }));
  const gaps = points.slice(1).flatMap((p, i) => {
    const before = points[i]?.time ?? 0;
    return p.time - before > DAY ? [{ start: before + DAY, end: p.time }] : [];
  });
  const html = renderToStaticMarkup(
    <InstrumentChart
      item={{
        id: "synthetic",
        ticker: "SYN",
        price: 120,
        status: "closed",
        statusLabel: "Closed",
        description: "Synthetic daily closes",
        path: {
          label: "Synthetic daily closes",
          points,
          dates: true,
          session: {
            start: points[0]?.time ?? 0,
            end: (points.at(-1)?.time ?? 0) + DAY,
          },
          sessionGaps: gaps,
        },
      }}
    />,
  );
  expect(html).toContain(">Aug<");
});
