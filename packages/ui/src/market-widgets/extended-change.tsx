import type { InstrumentDisplay } from "./types";
import { InstrumentChange } from "./values";
import { instrumentNumber } from "./format";
import { instrumentActivity } from "./activity";

export function extendedDescription(item: InstrumentDisplay) {
  const value =
    instrumentActivity(item).data !== "unavailable" && item.extended;
  if (!value) return undefined;
  const signed = (n: number, precision = item.precision) =>
    `${n > 0 ? "+" : ""}${instrumentNumber(n, precision)}`;
  const change = [
    value.absolute == null ? null : signed(value.absolute),
    value.percent == null ? null : `${signed(value.percent, 2)}%`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${value.label}: ${instrumentNumber(value.price, item.precision)}${item.unit ? ` ${item.unit}` : ""}. ${change ? `${change} since the last regular close.` : "Change unavailable."}`;
}

/** Small extended-hours comparison; the regular quote remains the primary value.
 * The caller qualifies its relation to the last regular close and may retain it
 * after trading closes. The title preserves full price/change context, colors
 * follow shared themes, and absent/unavailable extended data renders nothing. */
export function InstrumentExtendedSummary({
  item,
}: {
  item: InstrumentDisplay;
}) {
  if (instrumentActivity(item).data === "unavailable" || !item.extended)
    return null;
  const value = item.extended;
  return (
    <span
      data-slot="instrument-extended-summary"
      title={extendedDescription(item)}
      className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[10px]"
    >
      <span className="text-foreground-secondary">{value.label}</span>
      <InstrumentChange
        item={{
          ...item,
          id: `${item.id}:extended`,
          change: {
            absolute: value.absolute,
            percent: value.percent,
            basis: "Since the last regular close",
          },
        }}
        mode="percent"
      />
    </span>
  );
}
