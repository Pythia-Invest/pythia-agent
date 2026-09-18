"use client";

import { useState } from "react";
import {
  Button,
  InstrumentChange,
  InstrumentExtendedSummary,
  InstrumentIdentity,
  InstrumentPathView,
  InstrumentPrice,
  InstrumentSparkline,
} from "@pythia/ui";
import {
  activityExamples,
  pathExamples,
  presentationExample,
} from "./market-presentation-fixtures";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function MarketPresentationPreview() {
  const [ticks, setTicks] = useState(0);
  const quote = {
    ...presentationExample,
    price:
      presentationExample.price == null
        ? null
        : presentationExample.price + ticks * 0.1,
    change: {
      absolute: 2 + ticks * 0.1,
      percent: 2 + ticks * 0.1,
      basis: "Synthetic previous close",
    },
  };
  return (
    <SpecimenGrid>
      <Specimen label="Synthetic market activity and observation quality">
        <div className="flex flex-wrap gap-4">
          {activityExamples.map((activity, index) => (
            <div
              key={`${activity.session}-${activity.data}-${index}`}
              className="w-52 min-w-0"
            >
              <InstrumentIdentity item={{ ...presentationExample, activity }} />
              <p className="text-foreground-secondary text-xs">
                {activity.session} · {activity.data}
              </p>
            </div>
          ))}
        </div>
        <DemoNote>
          Focus, hover or tap the dots and icons. Market activity is independent
          of data delay and health.
        </DemoNote>
      </Specimen>
      <Specimen label="Synthetic values and update feedback">
        <div className="flex items-baseline gap-3">
          <InstrumentPrice item={quote} />
          <InstrumentChange item={quote} mode="both" />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setTicks(ticks + 1)}
        >
          Simulate quote update
        </Button>
        <InstrumentExtendedSummary
          item={{
            ...presentationExample,
            status: "closed",
            extended: {
              label: "Post",
              price: 103,
              absolute: 1,
              percent: 0.98,
              time: "2028-04-12T22:00:00Z",
            },
          }}
        />
        <div className="flex items-baseline gap-3">
          <InstrumentPrice
            item={{
              ...presentationExample,
              price: 4.062,
              precision: 3,
              priceSuffix: "%",
            }}
          />
          <InstrumentChange
            item={{
              ...presentationExample,
              change: {
                absolute: 2.4,
                unit: "bp",
                basis: "Synthetic previous close",
              },
            }}
          />
        </div>
        <DemoNote>
          Signs, units and supplied comparison bases remain intact. The
          post-market comparison survives the market closing. Reduced-motion
          preferences suppress update animation.
        </DemoNote>
      </Specimen>
      <Specimen label="Synthetic partial session and independent chart loading">
        <InstrumentIdentity item={presentationExample} />
        <InstrumentPrice item={presentationExample} />
        <InstrumentPathView item={presentationExample} height={40} />
        <InstrumentPathView
          item={{
            ...presentationExample,
            path: undefined,
            pathState: "loading",
          }}
          height={40}
        />
        <InstrumentPathView
          item={{
            ...presentationExample,
            path: undefined,
            pathState: "unavailable",
          }}
          height={40}
        />
        <InstrumentIdentity item={presentationExample} loading />
        <DemoNote>
          Each history region reserves its height. Loading status marks stay
          absent; a quote can remain visible while its history loads.
        </DemoNote>
      </Specimen>
      {pathExamples.map((series) => (
        <Specimen key={series.label} label={series.label}>
          <InstrumentSparkline series={series} height={40} dot={false} />
        </Specimen>
      ))}
    </SpecimenGrid>
  );
}
