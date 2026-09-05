"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { mergeStatefulClassName } from "./class-name";

export type CheckboxProps = Omit<CheckboxPrimitive.Root.Props, "children">;

/**
 * Binary or indeterminate selection control for reusable form presentation.
 *
 * Props and controlled/uncontrolled, disabled, read-only, required, and mixed
 * states follow Base UI. Public/Product density and light/dark colors come from
 * semantic tokens; checked state stays neutral. Base UI retains native form,
 * focus, pointer, and Space-key behavior. Pair it with a persistent visible
 * label; do not use it as a workflow-specific toggle.
 */
export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={mergeStatefulClassName("pythia-checkbox", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="pythia-checkbox__indicator">
        <Check aria-hidden="true" className="pythia-checkbox__check" />
        <Minus aria-hidden="true" className="pythia-checkbox__mixed" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
