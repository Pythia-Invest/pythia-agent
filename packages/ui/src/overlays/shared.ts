/**
 * Class recipes shared by the overlay family so dialogs, drawers, popovers,
 * menus, and preview cards keep one elevated surface and one text hierarchy.
 */
export const overlayClasses = {
  backdrop:
    "fixed inset-0 z-50 bg-foreground/45 transition-opacity motion-standard data-starting-style:opacity-0 data-ending-style:opacity-0",
  /** Elevated surface for every floating or modal popup. */
  surface: "border border-border bg-overlay text-foreground shadow-overlay",
  title: "m-0 text-reading font-semibold leading-tight text-foreground",
  description: "mt-2 mb-0 text-body leading-ui text-foreground-secondary",
  close:
    "min-h-control cursor-pointer rounded-control border-0 bg-transparent text-foreground-secondary hover:bg-interaction-hover hover:text-foreground active:bg-interaction-active",
  positioner: "z-60 outline-0",
  /** Anchored popup (popover, menu, preview card). */
  floating:
    "w-max max-w-[min(24rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-container p-4 transition-[opacity,transform] motion-fast data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.97] data-ending-style:opacity-0",
  arrow: "fill-overlay stroke-border",
} as const;
