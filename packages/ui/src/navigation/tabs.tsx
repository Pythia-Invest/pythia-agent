"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { mergeStatefulClassName } from "./class-name";

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
      className={mergeStatefulClassName("pythia-tabs", className)}
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
      className={mergeStatefulClassName("pythia-tabs__list", className)}
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
      className={mergeStatefulClassName("pythia-tabs__tab", className)}
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
      className={mergeStatefulClassName("pythia-tabs__panel", className)}
      {...props}
    />
  );
}
