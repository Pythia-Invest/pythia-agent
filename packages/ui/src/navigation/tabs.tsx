"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cnState } from "../class-name";

export type TabsProps = TabsPrimitive.Root.Props;

/**
 * Coordinates a set of tabs and their corresponding panels.
 *
 * Controlled/uncontrolled value and horizontal/vertical orientation props are
 * Base UI's API. Profile density and light/dark styling live on its parts, with
 * active state expressed through neutral selection tokens. Base UI owns tab
 * semantics, focus order, activation direction, and keyboard behavior. Use for
 * peer views of one context; do not use tabs as route or workflow state.
 */
export function Tabs({ className, ...props }: TabsProps) {
  return (
    <TabsPrimitive.Root
      className={cnState(
        "min-w-0 max-w-full text-body text-foreground",
        className,
      )}
      data-slot="tabs"
      {...props}
    />
  );
}

export type TabsListProps = TabsPrimitive.List.Props;

/**
 * Groups `Tab` controls and configures their activation behavior.
 *
 * Base UI's activate-on-focus and loop-focus props pass through with native
 * orientation state. Semantic tokens adapt the list to both profiles/themes.
 * Base UI owns roving focus and arrow-key navigation. Give each tab a matching
 * panel; do not attach a second keyboard handler.
 */
export function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cnState(
        "flex max-w-full items-center gap-1 overflow-x-auto border-border border-b data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[orientation=vertical]:border-r data-[orientation=vertical]:border-b-0",
        className,
      )}
      data-slot="tabs-list"
      {...props}
    />
  );
}

export type TabProps = TabsPrimitive.Tab.Props;

/**
 * One interactive tab controlling the panel with the same value.
 *
 * Value, disabled, render, and state-aware props remain Base UI's contract.
 * Active, hover, focus, Public/Product, and light/dark states use neutral
 * semantic tokens. Base UI supplies tab roles, selection, and keyboard
 * activation. Use concise peer-view labels; do not use signal amber for active.
 */
export function Tab({ className, ...props }: TabProps) {
  return (
    <TabsPrimitive.Tab
      className={cnState(
        "motion-fast min-h-control border-0 border-transparent border-b-2 bg-transparent px-3 py-1 text-foreground-secondary transition-colors hover:bg-interaction-hover hover:text-foreground data-disabled:cursor-not-allowed data-active:border-primary data-[orientation=vertical]:border-r-2 data-[orientation=vertical]:border-b-0 data-active:bg-transparent data-[orientation=vertical]:text-start data-active:text-foreground data-disabled:opacity-disabled",
        className,
      )}
      data-slot="tab"
      {...props}
    />
  );
}

export type TabPanelProps = TabsPrimitive.Panel.Props;

/**
 * Content panel associated with a `Tab` value.
 *
 * Value and keep-mounted props pass directly to Base UI, including hidden and
 * transition states. It inherits profile/theme text and spacing without a
 * fork. Base UI owns tabpanel labeling, visibility, and focusability. Keep one
 * panel per tab value; do not manage panel visibility separately.
 */
export function TabPanel({ className, ...props }: TabPanelProps) {
  return (
    <TabsPrimitive.Panel
      className={cnState("py-4", className)}
      data-slot="tab-panel"
      {...props}
    />
  );
}
