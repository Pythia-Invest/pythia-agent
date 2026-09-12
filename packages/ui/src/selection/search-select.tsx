"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { ChevronDown, Search } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { cn, cnState } from "../class-name";
import {
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPortal,
  ComboboxPositioner,
} from "./combobox";
import { pickerClasses } from "./shared";

export type SearchSelectRootProps<
  Value,
  Multiple extends boolean | undefined = false,
> = ComboboxPrimitive.Root.Props<Value, Multiple>;

/**
 * Native combobox state with an ephemeral popup query.
 *
 * Uncontrolled search text resets whenever the popup closes, so opening a
 * value selector always starts from its complete option set. Controlled input
 * state remains fully owned by the caller.
 */
export function SearchSelectRoot<
  Value,
  Multiple extends boolean | undefined = false,
>({
  defaultInputValue,
  inputValue: controlledInputValue,
  onInputValueChange,
  onOpenChange,
  ...props
}: SearchSelectRootProps<Value, Multiple>) {
  const [inputValue, setInputValue] = useState(defaultInputValue ?? "");
  const inputIsControlled = controlledInputValue !== undefined;

  return (
    <ComboboxPrimitive.Root
      inputValue={inputIsControlled ? controlledInputValue : inputValue}
      onInputValueChange={(nextValue, eventDetails) => {
        if (!inputIsControlled) setInputValue(nextValue);
        onInputValueChange?.(nextValue, eventDetails);
      }}
      onOpenChange={(open, eventDetails) => {
        if (!open && !inputIsControlled) setInputValue("");
        onOpenChange?.(open, eventDetails);
      }}
      {...props}
    />
  );
}

/** Visual treatment for the button that displays the selected value. */
export type SearchSelectTriggerAppearance = "field" | "inline";

export type SearchSelectTriggerProps = ComboboxPrimitive.Trigger.Props & {
  appearance?: SearchSelectTriggerAppearance;
};

const triggerAppearance: Record<SearchSelectTriggerAppearance, string> = {
  field: `${pickerClasses.controlHeight} min-w-42 border border-border px-2.5 text-sm hover:border-border-strong`,
  inline:
    "h-7 min-h-7 min-w-0 border-0 px-1.5 text-xs hover:bg-interaction-hover data-popup-open:bg-interaction-hover",
};

/**
 * Button-form combobox trigger for a search field that lives in the popup.
 *
 * Base UI gives this button combobox semantics when the input is mounted inside
 * the popup. `inline` is the quiet compact treatment for secondary settings.
 */
export function SearchSelectTrigger({
  appearance = "field",
  children,
  className,
  ...props
}: SearchSelectTriggerProps) {
  return (
    <ComboboxPrimitive.Trigger
      className={cnState(
        `motion-fast inline-flex cursor-pointer items-center justify-between gap-1.5 rounded-control bg-transparent text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 data-disabled:cursor-not-allowed data-disabled:opacity-disabled ${triggerAppearance[appearance]}`,
        className,
      )}
      data-appearance={appearance}
      data-slot="search-select-trigger"
      {...props}
    >
      {children}
      <span
        className={`${pickerClasses.chevron} shrink-0 [&>svg]:size-3`}
        data-slot="search-select-icon"
      >
        <ChevronDown aria-hidden="true" />
      </span>
    </ComboboxPrimitive.Trigger>
  );
}

export type SearchSelectValueProps = ComboboxPrimitive.Value.Props & {
  className?: string | undefined;
};

/** Selected value displayed by `SearchSelectTrigger`. */
export function SearchSelectValue({
  className,
  ...props
}: SearchSelectValueProps) {
  return (
    <span
      className={cn("min-w-0 truncate", className)}
      data-slot="search-select-value"
    >
      <ComboboxPrimitive.Value {...props} />
    </span>
  );
}

export type SearchSelectPopupProps = ComboboxPrimitive.Popup.Props;

/** Popup shell for a search input followed by its inset result viewport. */
export function SearchSelectPopup({
  className,
  ...props
}: SearchSelectPopupProps) {
  return (
    <ComboboxPrimitive.Popup
      className={cnState(
        `${pickerClasses.popup} max-h-[min(22rem,var(--available-height))] shadow-popup`,
        className,
      )}
      data-slot="search-select-popup"
      {...props}
    />
  );
}

export type SearchSelectInputProps = ComboboxPrimitive.Input.Props;

/** Search field fixed to the top of a `SearchSelectPopup`. */
export function SearchSelectInput({
  className,
  ...props
}: SearchSelectInputProps) {
  return (
    <div
      className="m-1 mb-0 flex h-8 shrink-0 items-center gap-2 rounded-control border border-border bg-raised px-2 transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-inset"
      data-slot="search-select-input-row"
    >
      <Search
        aria-hidden="true"
        className="size-3.5 shrink-0 text-foreground-secondary"
      />
      <ComboboxPrimitive.Input
        className={cnState(
          "min-w-0 flex-1 border-0 bg-transparent text-foreground text-xs outline-0 placeholder:text-foreground-secondary",
          className,
        )}
        data-slot="search-select-input"
        {...props}
      />
    </div>
  );
}

export type SearchSelectListProps = ComponentProps<typeof ComboboxList>;

/** Inset scrolling results; compact density is the searchable-select default. */
export function SearchSelectList({
  className,
  density = "compact",
  ...props
}: SearchSelectListProps) {
  return (
    <ComboboxList
      className={cnState(
        "m-1 max-h-[min(19.25rem,calc(var(--available-height)-2.75rem))]",
        className,
      )}
      density={density}
      {...props}
    />
  );
}

/**
 * Searchable single-value selection whose text field appears inside its popup.
 * Root, portal, positioning, option, and empty-state behavior remain the native
 * Base UI combobox contract; these parts only establish the supported layout.
 */
export const SearchSelect = {
  Root: SearchSelectRoot,
  Trigger: SearchSelectTrigger,
  Value: SearchSelectValue,
  Portal: ComboboxPortal,
  Positioner: ComboboxPositioner,
  Popup: SearchSelectPopup,
  Input: SearchSelectInput,
  List: SearchSelectList,
  Group: ComboboxGroup,
  GroupLabel: ComboboxGroupLabel,
  Item: ComboboxItem,
  Empty: ComboboxEmpty,
} as const;
