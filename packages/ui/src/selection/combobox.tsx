"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { createContext, useContext } from "react";
import { cnState } from "../class-name";
import { pickerClasses } from "./shared";

/**
 * Native Base UI searchable selection state owner for typed values.
 *
 * Single/multiple, controlled/uncontrolled, filtering, disabled, read-only,
 * open, and value-mapping props remain Base UI's API. It renders no themed
 * element; styling lives on its parts. Base UI owns input focus, highlighting,
 * selection, popup dismissal, and form behavior. Supply the native `items`
 * collection when using built-in filtering, then compose its parts directly;
 * do not mirror its item schema or manage active descendants yourself.
 */
export const Combobox = ComboboxPrimitive.Root;

export type ComboboxInputGroupProps = ComboboxPrimitive.InputGroup.Props;

/**
 * Styled container joining a combobox input and optional trigger.
 *
 * It forwards Base UI render and state-aware class props, including disabled,
 * invalid, and open states. Its compact height and typography match Select
 * while retaining a wider search minimum. Focus and keyboard behavior remain
 * on the native input and trigger. Use it only to group those controls; do not
 * place application actions inside it.
 */
export function ComboboxInputGroup({
  className,
  ...props
}: ComboboxInputGroupProps) {
  return (
    <ComboboxPrimitive.InputGroup
      className={cnState(
        `${pickerClasses.controlHeight} motion-fast inline-flex min-w-48 items-center rounded-control border border-border bg-raised text-foreground text-sm transition-colors focus-within:border-border-strong focus-within:outline-2 focus-within:outline-ring focus-within:outline-offset-2 hover:border-border-strong hover:bg-interaction-hover data-disabled:cursor-not-allowed data-disabled:opacity-disabled`,
        className,
      )}
      data-slot="combobox-input-group"
      {...props}
    />
  );
}

export type ComboboxInputProps = ComboboxPrimitive.Input.Props;

/**
 * Text input that filters and navigates a `Combobox` list.
 *
 * Native input, controlled value, disabled, read-only, validation, and
 * state-aware props pass through to Base UI. Placeholder and focus styling use
 * shared semantic tokens in both profiles/themes. Base UI owns combobox ARIA,
 * text editing, active descendant, and keyboard navigation. Provide an
 * accessible label; do not implement a second filtering keyboard handler.
 */
export function ComboboxInput({ className, ...props }: ComboboxInputProps) {
  return (
    <ComboboxPrimitive.Input
      className={cnState(
        "min-h-[calc(var(--spacing-control)-2px)] min-w-0 flex-1 border-0 bg-transparent px-3 text-foreground outline-0 placeholder:text-foreground-secondary focus-visible:outline-none",
        className,
      )}
      data-slot="combobox-input"
      {...props}
    />
  );
}

export type ComboboxTriggerProps = ComboboxPrimitive.Trigger.Props;

/**
 * Optional button that opens or closes a `Combobox` popup.
 *
 * Disabled, open, render, and native button props pass directly to Base UI.
 * Neutral interaction tokens cover Public/Product and light/dark states. Base
 * UI owns button semantics, focus, pointer, and keyboard behavior. Use beside
 * `ComboboxInput`; do not add custom popup state to the trigger.
 */
export function ComboboxTrigger({
  children,
  className,
  ...props
}: ComboboxTriggerProps) {
  return (
    <ComboboxPrimitive.Trigger
      className={cnState(
        `${pickerClasses.chevron} self-stretch border-0 border-border border-l bg-transparent px-2 focus-visible:outline-none`,
        className,
      )}
      data-slot="combobox-trigger"
      {...props}
    >
      {children ?? <ChevronDown aria-hidden="true" />}
    </ComboboxPrimitive.Trigger>
  );
}

/**
 * Native portal boundary for a `Combobox` popup.
 *
 * Its optional container prop is Base UI's API, with no profile/theme or
 * selection translation. Base UI owns portal mounting and teardown. Wrap the
 * native positioner with it; do not introduce another portal or focus owner.
 */
export const ComboboxPortal = ComboboxPrimitive.Portal;

export type ComboboxPositionerProps = ComboboxPrimitive.Positioner.Props;

/**
 * Native anchored positioner for `ComboboxPopup`.
 *
 * Side, alignment, collision, and offset props remain Base UI's API. It has no
 * visual theme fork, while popup sizing follows profile aliases. Base UI owns
 * placement and viewport collision. Use inside `ComboboxPortal`; do not
 * calculate coordinates in consuming applications.
 */
export function ComboboxPositioner({
  className,
  sideOffset = 6,
  ...props
}: ComboboxPositionerProps) {
  return (
    <ComboboxPrimitive.Positioner
      className={cnState(pickerClasses.positioner, className)}
      data-slot="combobox-positioner"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export type ComboboxPopupProps = ComboboxPrimitive.Popup.Props;

/**
 * Visible surface containing a combobox list and status.
 *
 * Native Base UI popup/final-focus/transition props pass through. Shared
 * overlay, border, and motion tokens cover both profiles and themes. Base UI
 * owns focus restoration and dismissal. Keep the popup in the native
 * positioner; do not add Escape, outside-click, or focus-trap logic.
 */
export function ComboboxPopup({ className, ...props }: ComboboxPopupProps) {
  return (
    <ComboboxPrimitive.Popup
      className={cnState(`${pickerClasses.popup} p-1`, className)}
      data-slot="combobox-popup"
      {...props}
    />
  );
}

export type ComboboxDensity = "default" | "compact";

export type ComboboxListProps = ComboboxPrimitive.List.Props & {
  density?: ComboboxDensity;
};

const listDensity: Record<ComboboxDensity, string> = {
  default:
    "max-h-[min(20rem,calc(var(--available-height)-0.5rem))] scroll-py-1",
  compact:
    "max-h-[min(19.25rem,calc(var(--available-height)-0.5rem))] scroll-py-0.5",
};

const ComboboxDensityContext = createContext<ComboboxDensity>("default");

/**
 * Scrollable result list for a `Combobox`.
 *
 * It forwards Base UI list props and supplies one density to every descendant
 * item. Scrolling stays on this inset inner viewport, keeping its scrollbar and
 * first row clear of the rounded popup shell. Base UI owns listbox semantics,
 * active descendant, and keyboard navigation. Render native items or a native
 * collection inside; do not create a parallel focusable result list.
 */
export function ComboboxList({
  className,
  density = "default",
  ...props
}: ComboboxListProps) {
  return (
    <ComboboxDensityContext.Provider value={density}>
      <ComboboxPrimitive.List
        className={cnState(
          `overflow-y-auto overscroll-contain rounded-control ${listDensity[density]}`,
          className,
        )}
        data-density={density}
        data-slot="combobox-list"
        {...props}
      />
    </ComboboxDensityContext.Provider>
  );
}

export type ComboboxItemProps = ComboboxPrimitive.Item.Props & {
  density?: ComboboxDensity;
};

const itemDensity: Record<ComboboxDensity, string> = {
  default: pickerClasses.item,
  compact:
    "flex min-h-7 cursor-pointer items-center gap-1.5 rounded-control px-1.5 py-0.5 text-foreground text-xs data-highlighted:bg-interaction-hover data-disabled:cursor-not-allowed data-disabled:opacity-disabled",
};

/**
 * One selectable result in a `ComboboxList`.
 *
 * Typed value, index, disabled, render, and state-aware props remain Base UI's
 * API. It inherits the list density by default; compact rows align to a 28px
 * grid. Selected and highlighted states use neutral selection/interaction
 * tokens across profiles/themes. Base UI owns item matching, pointer selection,
 * and keyboard activation. Supply stable values; do not use amber as an active
 * cue.
 */
export function ComboboxItem({
  children,
  className,
  density: densityOverride,
  ...props
}: ComboboxItemProps) {
  const inheritedDensity = useContext(ComboboxDensityContext);
  const density = densityOverride ?? inheritedDensity;
  return (
    <ComboboxPrimitive.Item
      className={cnState(
        `${itemDensity[density]} data-selected:bg-interaction-active`,
        className,
      )}
      data-density={density}
      data-slot="combobox-item"
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator
        className={pickerClasses.indicator}
        data-slot="combobox-item-indicator"
      >
        <Check aria-hidden="true" />
      </ComboboxPrimitive.ItemIndicator>
      {children}
    </ComboboxPrimitive.Item>
  );
}

export type ComboboxEmptyProps = ComboboxPrimitive.Empty.Props;

/**
 * Non-interactive message rendered when a combobox has no matching items.
 *
 * It forwards Base UI render/state props and uses semantic secondary text in
 * Public/Product and light/dark. Base UI decides when the empty state appears
 * and announces list status through its native relationships. Use concise
 * absence text; do not turn it into application error handling.
 */
export function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return (
    <ComboboxPrimitive.Empty
      className={cnState(`${pickerClasses.empty} empty:hidden`, className)}
      data-slot="combobox-empty"
      {...props}
    />
  );
}

export type ComboboxGroupProps = ComboboxPrimitive.Group.Props;

/**
 * Semantic grouping container for related combobox items.
 *
 * Base UI group props pass through unchanged; it has no interactive states and
 * inherits both profile and theme. Base UI retains collection relationships.
 * Pair it with `ComboboxGroupLabel`; do not use spacing alone as a group name.
 */
export function ComboboxGroup({ className, ...props }: ComboboxGroupProps) {
  return (
    <ComboboxPrimitive.Group
      className={cnState("py-2", className)}
      data-slot="combobox-group"
      {...props}
    />
  );
}

export type ComboboxGroupLabelProps = ComboboxPrimitive.GroupLabel.Props;

/**
 * Accessible heading for a `ComboboxGroup`.
 *
 * It forwards Base UI label props, remains non-interactive, and uses semantic
 * secondary text in both profiles/themes. Native group labeling remains
 * intact. Use short category text; do not make the heading selectable.
 */
export function ComboboxGroupLabel({
  className,
  ...props
}: ComboboxGroupLabelProps) {
  return (
    <ComboboxPrimitive.GroupLabel
      className={cnState(pickerClasses.groupLabel, className)}
      data-slot="combobox-group-label"
      {...props}
    />
  );
}
