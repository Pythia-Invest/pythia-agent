export { financialBinding as binding } from "@pythia/market-data/widgets";
import {
  InstrumentTable,
  type InstrumentRead,
  type WidgetProps,
} from "@pythia/widget-sdk";

/** Input is already qualified display data; this module does no source reads. */
export default function Table({ data, options }: WidgetProps<InstrumentRead>) {
  return <InstrumentTable read={data} options={options} />;
}
