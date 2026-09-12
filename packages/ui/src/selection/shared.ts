/** Recipes shared by Select, Combobox and Command so pickers read as one family. */
export const pickerClasses = {
  /** Compact trigger/input height; Public profile controls are capped at 2.25rem here. */
  controlHeight:
    "h-[min(var(--spacing-control),2.25rem)] min-h-[min(var(--spacing-control),2.25rem)]",
  positioner: "z-50",
  popup:
    "min-w-(--anchor-width) overflow-hidden rounded-container border border-border bg-overlay text-body text-foreground",
  list: "max-h-72 overflow-y-auto p-1",
  item: "flex min-h-control cursor-pointer items-center gap-2 rounded-control px-2 py-1 text-foreground data-highlighted:bg-interaction-hover data-disabled:cursor-not-allowed data-disabled:opacity-disabled",
  indicator:
    "inline-flex w-4 items-center justify-center text-primary [&>svg]:size-3.5",
  groupLabel: "p-2 text-xs font-semibold text-foreground-secondary",
  empty: "p-4 text-center text-foreground-secondary",
  separator: "h-px bg-border",
  chevron:
    "inline-flex items-center justify-center text-foreground-secondary [&>svg]:size-4",
} as const;
