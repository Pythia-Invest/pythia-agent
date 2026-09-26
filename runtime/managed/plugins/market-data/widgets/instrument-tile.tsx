export { financialBinding as binding } from "@pythia/market-data/widgets";
import {
  InstrumentReadState,
  InstrumentTile,
  type InstrumentRead,
  type InstrumentWidgetOptions,
  type WidgetProps,
} from "@pythia/widget-sdk";

/** `instrument-panel` is the same tile filling its host, for a page section. */
export default function Tiles({
  data,
  options,
  presentation,
}: WidgetProps<InstrumentRead, InstrumentWidgetOptions>) {
  const panel = presentation === "instrument-panel";
  if (data.state === "error" || data.state === "empty" || !data.rows.length)
    return <InstrumentReadState read={data} />;
  return (
    <div
      data-slot="market-data-tiles"
      className="flex flex-wrap items-start gap-2"
      aria-busy={data.state === "loading" || undefined}
    >
      {data.rows.map((item) => (
        <InstrumentTile
          key={item.id}
          item={item}
          options={options}
          className={
            panel
              ? "w-full border-transparent bg-transparent p-0"
              : options.compact
                ? "w-64 max-w-full shrink-0 border-border/55"
                : "w-44 max-w-full shrink-0 border-border/55"
          }
          loading={data.state === "loading"}
        />
      ))}
    </div>
  );
}
