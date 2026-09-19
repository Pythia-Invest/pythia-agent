import { type Context, useContext, useEffect, useState } from "react";
import {
  InstrumentPrice,
  type InstrumentDisplay,
  type WidgetProps,
} from "@pythia/widget-sdk";

const counters = globalThis as typeof globalThis & {
  widgetFactories?: number;
  widgetMounts?: number;
  widgetUnmounts?: number;
  widgetEvents?: number;
};
counters.widgetFactories = (counters.widgetFactories ?? 0) + 1;

type Data = {
  context: Context<string>;
  hostUseState: typeof useState;
  hostInstrumentPrice: typeof InstrumentPrice;
  item: InstrumentDisplay;
  crash: boolean;
};

export default function QualificationWidget({
  data,
  settings,
  options,
  locale,
  timeZone,
  appearance,
  presentation,
}: WidgetProps<Data>) {
  const [count, setCount] = useState(0);
  const context = useContext(data.context);
  useEffect(() => {
    counters.widgetMounts = (counters.widgetMounts ?? 0) + 1;
    const handle = () => {
      counters.widgetEvents = (counters.widgetEvents ?? 0) + 1;
    };
    window.addEventListener("widget-qualification", handle);
    return () => {
      counters.widgetUnmounts = (counters.widgetUnmounts ?? 0) + 1;
      window.removeEventListener("widget-qualification", handle);
    };
  }, []);
  if (data.crash && presentation !== "recovered") {
    throw new Error("Synthetic widget render failure");
  }
  return (
    <div data-slot="qualification-widget" className="p-[17px]">
      <button
        className="hover:scale-105"
        type="button"
        onClick={() => setCount((value) => value + 1)}
      >
        Count {count}
      </button>
      <span
        role="img"
        aria-label="Animated marker"
        className="inline-block animate-spin"
      >
        x
      </span>
      <p>React identity: {String(useState === data.hostUseState)}</p>
      <p>UI identity: {String(InstrumentPrice === data.hostInstrumentPrice)}</p>
      <p>{context}</p>
      <p>
        {String(settings.label)} / {String(options.compact)} / {locale} /{" "}
        {timeZone} / {appearance?.theme}
      </p>
      <InstrumentPrice item={data.item} />
    </div>
  );
}
