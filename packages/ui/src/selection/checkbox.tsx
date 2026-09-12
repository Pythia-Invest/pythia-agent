"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cnState } from "../class-name";

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
      className={cnState(
        "group motion-fast inline-flex size-[1.125rem] flex-none items-center justify-center rounded-[calc(var(--radius-control)/2)] border border-border-strong bg-raised text-foreground transition-colors hover:bg-interaction-hover data-disabled:cursor-not-allowed data-checked:border-primary data-indeterminate:border-primary data-checked:bg-primary data-indeterminate:bg-primary data-checked:text-primary-foreground data-indeterminate:text-primary-foreground data-disabled:opacity-disabled",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="inline-flex items-center justify-center [&>svg]:size-[0.8rem] [&>svg]:stroke-[2.5]"
        data-slot="checkbox-indicator"
      >
        <Check
          aria-hidden="true"
          className="group-data-indeterminate:hidden"
          data-slot="checkbox-check"
        />
        <Minus
          aria-hidden="true"
          className="hidden group-data-indeterminate:block"
          data-slot="checkbox-mixed"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
