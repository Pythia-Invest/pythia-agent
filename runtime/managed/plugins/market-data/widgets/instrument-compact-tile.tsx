export { financialBinding as binding } from "@pythia/market-data/widgets";
import {
  InstrumentCompactTile,
  InstrumentReadState,
  type InstrumentRead,
  type WidgetProps,
} from "@pythia/widget-sdk";

export default function Compact({
  data,
  options,
}: WidgetProps<InstrumentRead>) {
  if (data.state === "error" || data.state === "empty" || !data.rows.length)
    return <InstrumentReadState read={data} />;
  return (
    <div
      data-slot="market-data-compact"
      className="flex flex-wrap items-start gap-2"
      aria-busy={data.state === "loading" || undefined}
    >
      {data.rows.map((item) => (
        <InstrumentCompactTile
          key={item.id}
          item={item}
          options={options}
          className="w-64 max-w-full shrink-0 border-border/55"
          loading={data.state === "loading"}
        />
      ))}
    </div>
  );
}
