"use client";

import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import type { ComponentProps } from "react";
import { joinClassNames } from "./class-name";

export type CommandProps = ComponentProps<typeof CommandPrimitive>;

/**
 * Searchable command surface using cmdk's native filtering and navigation.
 *
 * Value, search filtering, looping, pointer-selection, Vim-binding, and ARIA
 * label props remain cmdk's API. Semantic tokens adapt it to Public/Product and
 * light/dark while selected items stay neutral. Cmdk owns matching, active
 * item, focus, and keyboard behavior. Use for reusable command choices; do not
 * add routes, product data, or a second selection store.
 */
export function Command({ className, ...props }: CommandProps) {
  return (
    <CommandPrimitive
      className={joinClassNames("pythia-command", className)}
      {...props}
    />
  );
}

export type CommandInputProps = ComponentProps<typeof CommandPrimitive.Input>;

/**
 * Search input for a `Command` surface.
 *
 * Native input and cmdk controlled-search props pass through, including
 * disabled and placeholder states. Profile sizing and light/dark colors use
 * semantic tokens. Cmdk owns search updates and keyboard navigation. Provide a
 * useful placeholder or label; do not attach a competing key handler.
 */
export function CommandInput({ className, ...props }: CommandInputProps) {
  return (
    <div className="pythia-command__input-row">
      <Search aria-hidden="true" className="pythia-command__search-icon" />
      <CommandPrimitive.Input
        className={joinClassNames("pythia-command__input", className)}
        {...props}
      />
    </div>
  );
}

export type CommandListProps = ComponentProps<typeof CommandPrimitive.List>;

/**
 * Scrollable cmdk result list.
 *
 * Its native list label and DOM props pass through with no new variants.
 * Profile density and light/dark styling are token-driven. Cmdk owns active
 * descendant and arrow-key navigation. Render command groups/items inside; do
 * not build another focusable result list.
 */
export function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CommandPrimitive.List
      className={joinClassNames("pythia-command__list", className)}
      {...props}
    />
  );
}

export type CommandItemProps = ComponentProps<typeof CommandPrimitive.Item>;

/**
 * One selectable cmdk command or result.
 *
 * Stable value, keywords, disabled, force-mount, and onSelect props are cmdk's
 * native contract. Selected/disabled states use neutral semantic tokens in all
 * profiles/themes. Cmdk owns filtering, pointer activation, and Enter-key
 * selection. Put reusable display content here; do not encode route decisions.
 */
export function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      className={joinClassNames("pythia-command__item", className)}
      {...props}
    />
  );
}

export type CommandGroupProps = ComponentProps<typeof CommandPrimitive.Group>;

/**
 * Labelled group of related cmdk items.
 *
 * Heading, stable value, force-mount, and DOM props pass directly to cmdk. It
 * inherits semantic profile/theme treatment and has no selection state of its
 * own. Cmdk retains filtering and group visibility. Use a concise heading; do
 * not use groups as application workflow sections.
 */
export function CommandGroup({ className, ...props }: CommandGroupProps) {
  return (
    <CommandPrimitive.Group
      className={joinClassNames("pythia-command__group", className)}
      {...props}
    />
  );
}

export type CommandEmptyProps = ComponentProps<typeof CommandPrimitive.Empty>;

/**
 * Message cmdk shows when filtering returns no command items.
 *
 * Native DOM props pass through; the state is automatic and uses semantic
 * secondary text in Public/Product and light/dark. Cmdk determines visibility
 * from its filter state. Use concise absence copy; do not treat this as a
 * product error or incomplete-data state.
 */
export function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return (
    <CommandPrimitive.Empty
      className={joinClassNames("pythia-command__empty", className)}
      {...props}
    />
  );
}

export type CommandLoadingProps = ComponentProps<
  typeof CommandPrimitive.Loading
>;

/**
 * Cmdk-owned loading row for asynchronous command choices.
 *
 * Progress and accessible label props remain cmdk's API. Semantic secondary
 * text works in both profiles/themes; progress meaning is exposed through
 * cmdk's native role. Use only with a real progress estimate or descriptive
 * label; do not fabricate a percentage.
 */
export function CommandLoading({ className, ...props }: CommandLoadingProps) {
  return (
    <CommandPrimitive.Loading
      className={joinClassNames("pythia-command__loading", className)}
      {...props}
    />
  );
}

export type CommandSeparatorProps = ComponentProps<
  typeof CommandPrimitive.Separator
>;

/**
 * Visual and semantic separator between cmdk groups.
 *
 * Cmdk's always-render and DOM props pass through. It uses the shared border
 * token across Public/Product and light/dark and creates no keyboard stop. Use
 * between meaningful groups; do not substitute it for a heading.
 */
export function CommandSeparator({
  className,
  ...props
}: CommandSeparatorProps) {
  return (
    <CommandPrimitive.Separator
      className={joinClassNames("pythia-command__separator", className)}
      {...props}
    />
  );
}
