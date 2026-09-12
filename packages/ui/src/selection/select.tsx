"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown } from "lucide-react";
import { cnState } from "../class-name";
import { pickerClasses } from "./shared";

/**
 * Native Base UI select state owner for single or multiple typed values.
 *
 * All controlled/uncontrolled, open, item-mapping, disabled, read-only, and
 * form props remain Base UI's API. It renders no element, so profile/theme
 * styling lives on its parts. Base UI owns selection, typeahead, focus,
 * dismissal, and form behavior. Compose the documented parts; do not mirror
 * its value schema in application wrappers.
 */
export const Select = SelectPrimitive.Root;

const triggerClasses = cva(
  "motion-fast inline-flex cursor-pointer items-center text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-disabled:cursor-not-allowed data-disabled:opacity-disabled",
  {
    variants: {
      appearance: {
        field: `${pickerClasses.controlHeight} min-w-42 justify-between gap-2 rounded-control border border-border bg-transparent px-2.5 text-sm hover:border-border-strong`,
        inline:
          "h-8 min-w-0 justify-start gap-1.5 rounded-control border-0 bg-transparent px-2 text-body hover:bg-interaction-hover data-popup-open:bg-interaction-hover [&_[data-slot=select-icon]>svg]:size-3 [&_[data-slot=select-icon]]:shrink-0",
      },
    },
    defaultVariants: { appearance: "field" },
  },
);

/** Visual treatment for the select trigger. */
export type SelectTriggerAppearance = NonNullable<
  VariantProps<typeof triggerClasses>["appearance"]
>;

export type SelectTriggerProps = SelectPrimitive.Trigger.Props & {
  appearance?: SelectTriggerAppearance;
};

/**
 * Button that opens a `Select` popup and displays its value.
 *
 * `field` is the ordinary bordered form control; `inline` is the compact
 * labelled chip for toolbars. It accepts native Base UI trigger props and
 * supports disabled, placeholder, and open states. Semantic tokens provide
 * Public/Product sizing and light/dark treatment. Base UI supplies button
 * semantics and keyboard/focus behavior. Render `SelectValue` inside it; do
 * not replace it with a bespoke popup button.
 */
export function SelectTrigger({
  appearance = "field",
  children,
  className,
  ...props
}: SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cnState(triggerClasses({ appearance }), className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        className={pickerClasses.chevron}
        data-slot="select-icon"
      >
        <ChevronDown aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export type SelectValueProps = SelectPrimitive.Value.Props;

/**
 * Selected-value or placeholder text inside `SelectTrigger`.
 *
 * It preserves Base UI's value formatter and placeholder props and meaningful
 * placeholder state. Text colors follow semantic light/dark tokens identically
 * in Public and Product. It is announced through the native select trigger and
 * adds no keyboard behavior. Use it for display formatting; do not validate or
 * reinterpret application values here.
 */
export function SelectValue({ className, ...props }: SelectValueProps) {
  return (
    <SelectPrimitive.Value
      className={cnState(
        "data-placeholder:text-foreground-secondary",
        className,
      )}
      data-slot="select-value"
      {...props}
    />
  );
}

/**
 * Native portal boundary for a `Select` popup.
 *
 * Its optional container prop is Base UI's complete public API; it has no
 * selected or disabled states and no profile/theme fork. Base UI owns portal
 * placement and teardown. Use it around the positioner; do not add another
 * portal or dismissal manager.
 */
export const SelectPortal = SelectPrimitive.Portal;

export type SelectPositionerProps = SelectPrimitive.Positioner.Props;

/**
 * Native anchored positioner for `SelectPopup`.
 *
 * Side, alignment, collision, offset, and item-alignment props pass directly
 * to Base UI. It is theme-neutral while profile sizing comes from its popup.
 * Base UI owns placement and viewport collision behavior. Use inside
 * `SelectPortal`; do not calculate popup coordinates in application code.
 */
export function SelectPositioner({
  alignItemWithTrigger = false,
  className,
  sideOffset = 6,
  ...props
}: SelectPositionerProps) {
  return (
    <SelectPrimitive.Positioner
      alignItemWithTrigger={alignItemWithTrigger}
      className={cnState(pickerClasses.positioner, className)}
      data-slot="select-positioner"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export type SelectPopupProps = SelectPrimitive.Popup.Props;

/**
 * Visible surface containing a `SelectList`.
 *
 * Native Base UI popup props include final-focus and transition states.
 * Semantic overlay, border, and motion tokens adapt to both themes and
 * profiles. Base UI retains open/close focus restoration and dismissal. Place
 * it in the native positioner; do not add custom Escape or outside-click code.
 */
export function SelectPopup({ className, ...props }: SelectPopupProps) {
  return (
    <SelectPrimitive.Popup
      className={cnState(
        `${pickerClasses.popup} max-h-[min(20rem,var(--available-height))] rounded-control text-sm shadow-popup`,
        className,
      )}
      data-slot="select-popup"
      {...props}
    />
  );
}

export type SelectListProps = SelectPrimitive.List.Props;

/**
 * Scrollable option list inside `SelectPopup`.
 *
 * It accepts Base UI list props without new variants. Profile density and
 * light/dark treatment come from inherited semantic tokens. Base UI owns list
 * navigation and active descendant behavior. Put `SelectItem` children here;
 * do not implement a parallel keyboard list.
 */
export function SelectList({ className, ...props }: SelectListProps) {
  return (
    <SelectPrimitive.List
      className={cnState(pickerClasses.list, className)}
      data-slot="select-list"
      {...props}
    />
  );
}

export type SelectItemProps = SelectPrimitive.Item.Props;

/**
 * One typed option in a `SelectList`.
 *
 * Value, label, disabled, render, and native state-aware props pass to Base UI.
 * Selected and highlighted states use distinct neutral selection/interaction
 * tokens in every profile and theme. Base UI owns item selection, pointer,
 * typeahead, and focus behavior. Supply stable values and labels; do not use
 * signal amber to imply selection.
 */
export function SelectItem({ children, className, ...props }: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cnState(
        "relative flex min-h-8 cursor-pointer items-center rounded-control py-1.5 pr-8 pl-2 text-foreground text-sm leading-ui data-disabled:cursor-not-allowed data-highlighted:bg-interaction-hover data-disabled:opacity-disabled",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        className={`${pickerClasses.indicator} absolute end-2`}
        data-slot="select-item-indicator"
      >
        <Check aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export type SelectGroupProps = SelectPrimitive.Group.Props;

/**
 * Semantic grouping container for related select options.
 *
 * It forwards Base UI group props, has no interactive state, and inherits
 * profile/theme presentation. Its label relationship and selection behavior
 * remain native. Use with `SelectGroupLabel`; do not use visual spacing alone
 * to imply an option group.
 */
export function SelectGroup({ className, ...props }: SelectGroupProps) {
  return (
    <SelectPrimitive.Group
      className={cnState("py-1", className)}
      data-slot="select-group"
      {...props}
    />
  );
}

export type SelectGroupLabelProps = SelectPrimitive.GroupLabel.Props;

/**
 * Accessible heading for a `SelectGroup`.
 *
 * All Base UI label props pass through; the label is non-interactive and uses
 * semantic secondary text in light/dark with profile density inherited.
 * Assistive technology receives Base UI's group relationship. Use concise
 * category text; do not make the label selectable.
 */
export function SelectGroupLabel({
  className,
  ...props
}: SelectGroupLabelProps) {
  return (
    <SelectPrimitive.GroupLabel
      className={cnState(`${pickerClasses.groupLabel} px-2 py-1`, className)}
      data-slot="select-group-label"
      {...props}
    />
  );
}

export type SelectSeparatorProps = SelectPrimitive.Separator.Props;

/**
 * Non-interactive visual separator between select option groups.
 *
 * It forwards Base UI separator props and uses the semantic border token in
 * both profiles and themes. Base UI supplies separator semantics and no
 * keyboard stop. Use between meaningful groups; do not substitute separators
 * for group labels.
 */
export function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <SelectPrimitive.Separator
      className={cnState(`${pickerClasses.separator} mx-2 my-1`, className)}
      data-slot="select-separator"
      {...props}
    />
  );
}
