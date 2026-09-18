"use client";
import { useState } from "react";
import {
  InstrumentTile,
  InstrumentCompactTile,
  InstrumentTable,
  InstrumentSparkline,
  InstrumentStatusDot,
  Button,
  type InstrumentWidgetOptions,
} from "@pythia/ui";
import { widgetExamples, extraExamples } from "./market-widget-fixtures";
import { Specimen, SpecimenGrid, DemoNote } from "./specimen";
export function MarketWidgetsPreview() {
  const [ticks, setTicks] = useState(0);
  const first = widgetExamples[0];
  const [options, setOptions] = useState<InstrumentWidgetOptions>({
    name: true,
    path: true,
  });
  return (
    <SpecimenGrid>
      <div className="col-span-full">
        <Specimen label="Independent compact tables · synthetic lists">
          <div className="flex flex-wrap items-start gap-3">
            <InstrumentTable
              read={{ state: "ready", rows: widgetExamples.slice(0, 3) }}
              options={{ name: true, change: "both" }}
            />
            <InstrumentTable
              read={{ state: "ready", rows: widgetExamples.slice(3, 6) }}
              options={{ name: true, change: "both" }}
            />
          </div>
        </Specimen>
      </div>
      <Specimen label="Compact tiles · synthetic regular and extended quotes">
        <div className="flex flex-wrap gap-2">
          {[...widgetExamples, ...extraExamples].map((item) => (
            <InstrumentCompactTile
              key={item.id}
              item={item}
              options={{ name: true, change: "both" }}
              className="w-64"
            />
          ))}
          {widgetExamples[0] && (
            <InstrumentCompactTile
              item={widgetExamples[0]}
              loading
              options={{ name: true, change: "both" }}
              className="w-64"
            />
          )}
        </div>
      </Specimen>
      <Specimen label="Table · quotes first, history loading · 260px">
        <div style={{ width: 260 }}>
          <InstrumentTable
            read={{
              state: "ready",
              rows: widgetExamples.slice(0, 3).map((item) => ({
                ...item,
                path: undefined,
                pathState: "loading",
              })),
            }}
            options={{ name: true, change: "both" }}
          />
        </div>
      </Specimen>
      <Specimen label="Synthetic optional values · ready and loading">
        <div className="flex flex-wrap items-start gap-3">
          {first &&
            [false, true].map((loading) => (
              <InstrumentTile
                key={String(loading)}
                item={{
                  ...first,
                  extended: {
                    label: "Post",
                    price: 103.2,
                    percent: 1.18,
                    time: "2028-04-12T22:00:00Z",
                  },
                  book: {
                    bid: 99.98,
                    ask: 100.02,
                    bidSize: 120,
                    askSize: 80,
                    label: "Synthetic book · sizes in shares",
                  },
                }}
                loading={loading}
                options={{
                  name: true,
                  path: true,
                  unit: true,
                  range: true,
                  book: true,
                }}
                className="w-44"
              />
            ))}
        </div>
      </Specimen>
      <Specimen label="Synthetic rolling window · empty leading edge">
        <InstrumentSparkline
          series={{
            label: "Synthetic rolling week",
            window: { start: 0, end: 168 },
            points: [
              { time: 24, value: 10 },
              { time: 72, value: 12 },
              { time: 120, value: 9 },
              { time: 167, value: 11 },
            ],
            baseline: { value: 10, label: "First synthetic sample" },
          }}
        />
      </Specimen>
      <Specimen label="Synthetic instruments · display switches">
        <div className="mb-3 flex flex-wrap gap-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setTicks(ticks + 1)}
          >
            Simulate quote update
          </Button>
          {(["name", "note", "unit", "path", "range", "compact"] as const).map(
            (key) => (
              <label key={key} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={options[key] ?? key === "note"}
                  onChange={(e) =>
                    setOptions({ ...options, [key]: e.target.checked })
                  }
                />
                {key}
              </label>
            ),
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {[...widgetExamples, ...extraExamples].map((item) => (
            <InstrumentTile
              key={item.id}
              className="w-44"
              item={
                item.change
                  ? {
                      ...item,
                      change: {
                        ...item.change,
                        absolute:
                          item.change.absolute == null
                            ? item.change.absolute
                            : item.change.absolute + ticks * 0.1,
                        percent:
                          item.change.percent == null
                            ? item.change.percent
                            : item.change.percent + ticks * 0.1,
                      },
                    }
                  : item
              }
              options={options}
            />
          ))}
        </div>
        <DemoNote>
          All values, paths and session claims are invented design fixtures.
        </DemoNote>
      </Specimen>
      <Specimen label="260px table · synthetic partial failure">
        <div style={{ width: 260 }}>
          <InstrumentTable
            read={{
              rows: widgetExamples,
              state: "ready",
              message:
                "One synthetic feed is unavailable; its last price is withheld.",
            }}
            options={options}
          />
        </div>
      </Specimen>
      <Specimen label="Whole-list states">
        <InstrumentTable read={{ rows: [], state: "loading" }} />
        <InstrumentTable read={{ rows: [], state: "empty" }} />
        <InstrumentTable
          read={{
            rows: [],
            state: "error",
            message: "Synthetic feed failure. Previous values are withheld.",
          }}
        />
      </Specimen>
      <Specimen label="Baseline crossing and status words">
        <div className="flex gap-3">
          {widgetExamples.map((item) => (
            <InstrumentStatusDot
              key={item.id}
              status={item.status}
              label={item.statusLabel}
            />
          ))}
        </div>
        {widgetExamples[0]?.path && (
          <InstrumentSparkline series={widgetExamples[0].path} height={40} />
        )}
      </Specimen>
    </SpecimenGrid>
  );
}
