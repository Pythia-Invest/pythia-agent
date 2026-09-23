import { useState } from "react";
import {
  InstrumentTable,
  type InstrumentRead,
  type InstrumentWidgetOptions,
  type WidgetProps,
} from "@pythia/widget-sdk";

/** Rendering-only example. For canonical prices, also export the feature's
 * financialBinding as shown in the README; the SDK has no financial dependency. */
export default function Watchlist({
  data,
  options,
  settings,
}: WidgetProps<InstrumentRead, InstrumentWidgetOptions>) {
  const [showBoth, setShowBoth] = useState(false);
  const title =
    typeof settings.title === "string" ? settings.title : "Watchlist";
  return (
    <section className="w-fit max-w-full p-2 text-foreground">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="font-semibold text-sm">{title}</h2>
        <button
          type="button"
          className="rounded-control px-2 py-1 text-foreground-secondary text-xs hover:bg-subtle focus-visible:outline-2"
          aria-pressed={showBoth}
          onClick={() => setShowBoth((current) => !current)}
        >
          Absolute change
        </button>
      </div>
      <InstrumentTable
        read={data}
        options={{ ...options, change: showBoth ? "both" : "percent" }}
      />
    </section>
  );
}
