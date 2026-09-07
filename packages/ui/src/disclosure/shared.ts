/** Trigger and panel recipes shared by Accordion, Collapsible and Details. */
export const disclosureClasses = {
  trigger:
    "flex min-h-control w-full cursor-pointer items-center justify-between gap-3 border-0 bg-transparent px-2 py-3 text-start text-body font-semibold leading-ui text-foreground active:bg-interaction-active",
  icon: "size-4 flex-none text-foreground-secondary transition-transform motion-fast",
  /** Base UI measures the panel; the height variable drives the open/close motion. */
  panel:
    "overflow-hidden transition-[height] motion-standard data-starting-style:h-0 data-ending-style:h-0",
  content: "px-2 pb-4 text-body leading-ui text-foreground-secondary",
} as const;
