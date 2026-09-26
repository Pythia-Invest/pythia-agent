import type {
  InstrumentRead,
  InstrumentWidgetOptions,
  WidgetProps,
} from "@pythia/widget-sdk";
import Compact from "./instrument-compact-tile";
import Table from "./instrument-table";
import Tiles from "./instrument-tile";

export { financialBinding as binding } from "@pythia/market-data/widgets";

/** One native feature asset shares financial adaptation across its views. */
export default function Instruments(
  props: WidgetProps<InstrumentRead, InstrumentWidgetOptions>,
) {
  if (
    props.presentation === "instrument-tile" ||
    props.presentation === "instrument-panel"
  )
    return <Tiles {...props} />;
  if (props.presentation === "instrument-compact-tile")
    return <Compact {...props} />;
  if (!props.presentation || props.presentation === "instrument-table")
    return <Table {...props} />;
  throw Error("This market-data presentation is unavailable.");
}
