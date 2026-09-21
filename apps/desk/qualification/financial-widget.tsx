import type { InstrumentRead, WidgetProps } from "@pythia/widget-sdk";
import Instruments from "../../../runtime/managed/plugins/market-data/widgets/instruments";
export { binding } from "../../../runtime/managed/plugins/market-data/widgets/instruments";

/** Observe the real canonical binding result even when shared UI would hide it. */
export default function FinancialProbe(props: WidgetProps<InstrumentRead>) {
  return (
    <div
      data-slot="canonical-binding-probe"
      data-has-history={Boolean(props.data.rows[0]?.path)}
    >
      <Instruments {...props} />
    </div>
  );
}
