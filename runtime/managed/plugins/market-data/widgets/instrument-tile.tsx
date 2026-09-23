export { financialBinding as binding } from "@pythia/market-data/widgets";
import {
  InstrumentReadState,
  InstrumentTile,
  type InstrumentRead,
  type InstrumentWidgetOptions,
  type WidgetProps,
} from "@pythia/widget-sdk";

export default function Tiles({
  data,
  options,
}: WidgetProps<InstrumentRead, InstrumentWidgetOptions>) {
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
            options.compact
              ? "w-64 max-w-full shrink-0 border-border/55"
              : "w-44 max-w-full shrink-0 border-border/55"
          }
          loading={data.state === "loading"}
        />
      ))}
    </div>
  );
}
