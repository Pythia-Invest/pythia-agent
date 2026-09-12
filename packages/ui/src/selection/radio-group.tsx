"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cnState } from "../class-name";

export type RadioGroupProps<Value = unknown> =
  RadioGroupPrimitive.Props<Value> & {
    /**
     * Lays the options out as a wrapping row instead of a stack. Base UI owns no
     * orientation prop and writes no `data-orientation`, so the attribute the
     * layout styles read is written here.
     */
    orientation?: "horizontal" | "vertical";
  };
export type RadioProps<Value = unknown> = Omit<
  RadioPrimitive.Root.Props<Value>,
  "children"
>;

/**
 * Coordinates a mutually exclusive set of `Radio` controls.
 *
 * Generic value, controlled/uncontrolled, disabled, read-only and required
 * props pass to Base UI; `orientation` is owned here. Semantic tokens adapt its spacing to
 * Public/Product and colors to light/dark. Base UI owns roving focus, arrow-key
 * selection, form values, and accessibility. Give the group a visible or ARIA
 * label; do not encode application validation here.
 */
export function RadioGroup<Value>({
  className,
  orientation = "vertical",
  ...props
}: RadioGroupProps<Value>) {
  return (
    <RadioGroupPrimitive
      className={cnState(
        "grid gap-group data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:items-center",
        className,
      )}
      data-orientation={orientation}
      data-slot="radio-group"
      {...props}
    />
  );
}

/**
 * One option inside a `RadioGroup`.
 *
 * Its generic value and disabled/read-only/required props are native Base UI
 * props. Selected, focus, Public/Product, and light/dark presentation uses
 * neutral semantic tokens. Base UI supplies radio semantics, hidden form input,
 * pointer handling, and group keyboard behavior. Put human-readable label text
 * beside the control; do not use standalone radios outside a group.
 */
export function Radio<Value>({ className, ...props }: RadioProps<Value>) {
  return (
    <RadioPrimitive.Root
      className={cnState(
        "motion-fast inline-flex size-[1.125rem] flex-none items-center justify-center rounded-pill border border-border-strong bg-raised text-foreground transition-colors hover:bg-interaction-hover data-disabled:cursor-not-allowed data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:opacity-disabled",
        className,
      )}
      data-slot="radio"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="size-[0.45rem] rounded-pill bg-primary-foreground"
        data-slot="radio-indicator"
      />
    </RadioPrimitive.Root>
  );
}
