"use client";
import { createContext, useContext, type ComponentProps } from "react";
import { Popover as SharedPopover } from "@pythia/ui";

/** Host-only provider. Portal DOM leaves the widget root but remains in its
 * React tree, so author utilities keep the same scope without global CSS. */
export const WidgetStyleScope = createContext<string | undefined>(undefined);
function ScopedPopoverPortal(
  props: ComponentProps<typeof SharedPopover.Portal>,
) {
  const scope = useContext(WidgetStyleScope);
  return <SharedPopover.Portal {...props} data-pythia-widget={scope} />;
}
export const Popover = { ...SharedPopover, Portal: ScopedPopoverPortal };
