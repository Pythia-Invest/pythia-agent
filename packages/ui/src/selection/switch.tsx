"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { mergeStatefulClassName } from "./class-name";

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
      className={mergeStatefulClassName("pythia-switch", className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pythia-switch__thumb" />
    </SwitchPrimitive.Root>
  );
}
