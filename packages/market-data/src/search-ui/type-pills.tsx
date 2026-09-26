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
      className="flex min-w-0 flex-wrap gap-1.5 rounded-none bg-transparent p-0"
    >
      {TYPE_FILTERS.map((filter) => (
        <Toggle<TypeFilter>
          key={filter.value}
          value={filter.value}
          label={filter.label}
          size="sm"
          onMouseDown={keepInputFocus}
          className="rounded-pill data-pressed:border-border-strong"
        />
      ))}
    </ToggleGroup>
  );
}
