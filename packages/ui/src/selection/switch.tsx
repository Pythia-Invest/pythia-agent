"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cnState } from "../class-name";

export type SwitchProps = Omit<SwitchPrimitive.Root.Props, "children">;

/**
 * Immediate on/off setting control, distinct from a form-submission checkbox.
 *
 * Controlled/uncontrolled, disabled, read-only, required, and form props pass
 * to Base UI. Neutral semantic tokens express on/off state across Public/
 * Product and light/dark. Base UI retains switch semantics, hidden form input,
 * focus, pointer, and Space-key behavior. Always pair it with a persistent
 * label; do not put delayed workflow submission logic in this component.
 */
export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cnState(
        "motion-fast inline-flex min-h-5 w-9 items-center rounded-pill border border-border-strong bg-subtle p-0.5 transition-colors hover:bg-interaction-hover data-disabled:cursor-not-allowed data-checked:border-primary data-checked:bg-primary data-disabled:opacity-disabled",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="motion-standard size-3.5 translate-x-0 rounded-pill bg-foreground-secondary transition-[background-color,transform] data-checked:translate-x-4 data-checked:bg-primary-foreground"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}
