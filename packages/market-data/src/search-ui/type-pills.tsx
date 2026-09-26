import { Toggle, ToggleGroup } from "@pythia/widget-sdk";
import type { MouseEvent } from "react";
import { TYPE_FILTERS, type TypeFilter } from "./search-model";

const keepInputFocus = (event: MouseEvent) => event.preventDefault();

/** Single-choice type filter. Pointer use never takes focus from the search
 * field; keyboard users reach it with Tab and move with the arrow keys. */
export function TypePills({
  value,
  onChange,
}: {
  value: TypeFilter;
  onChange(value: TypeFilter): void;
}) {
  return (
    <ToggleGroup<TypeFilter>
      label="Investment type"
      value={[value]}
      // Pressing the chosen pill again keeps it: one type is always chosen.
      onValueChange={([next]) => next && onChange(next)}
      data-slot="investment-search-types"
      // One row at every width: a narrow panel scrolls the pills sideways.
      className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto rounded-none bg-transparent p-0 [scrollbar-width:none]"
    >
      {TYPE_FILTERS.map((filter) => (
        <Toggle<TypeFilter>
          key={filter.value}
          value={filter.value}
          label={filter.label}
          size="sm"
          onMouseDown={keepInputFocus}
          className="flex-none rounded-pill data-pressed:border-border-strong"
        />
      ))}
    </ToggleGroup>
  );
}
