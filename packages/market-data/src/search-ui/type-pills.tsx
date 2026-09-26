import type { KeyboardEvent } from "react";
import { TYPE_FILTERS, type TypeFilter } from "./search-model";

/** Single-choice type filter. Pointer use never takes focus from the search
 * field; keyboard users reach it with Tab and move with the arrow keys. */
export function TypePills({
  value,
  onChange,
}: {
  value: TypeFilter;
  onChange(value: TypeFilter): void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const index = TYPE_FILTERS.findIndex((filter) => filter.value === value);
    const next =
      TYPE_FILTERS[
        (index + offset + TYPE_FILTERS.length) % TYPE_FILTERS.length
      ];
    if (!next) return;
    onChange(next.value);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)
      ?.focus();
  }
  return (
    <div
      role="radiogroup"
      aria-label="Investment type"
      data-slot="investment-search-types"
      onKeyDown={onKeyDown}
      className="flex min-w-0 flex-wrap gap-1.5"
    >
      {TYPE_FILTERS.map((filter) => {
        const checked = filter.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a pointer press must not move focus out of the search field, which a native radio does.
          <button
            key={filter.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={filter.value}
            tabIndex={checked ? 0 : -1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange(filter.value)}
            className="motion-fast h-7 flex-none cursor-pointer rounded-pill border border-border px-2.5 text-foreground-secondary text-xs transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-checked:border-border-strong aria-checked:bg-interaction-active aria-checked:text-foreground motion-reduce:transition-none"
          >
            {filter.label}
          </button>
        );
      })}
    </div>
  );
}
