"use client";

import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode, Ref } from "react";

const toggleClasses = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--py-radius-interactive)] border text-sm font-medium text-[var(--py-text-secondary)] transition-colors duration-[var(--py-motion-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--py-focus-ring)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-[var(--py-disabled-opacity)] data-[pressed]:bg-[var(--py-interaction-active)] data-[pressed]:font-semibold data-[pressed]:text-[var(--py-text-primary)]",
  {
    variants: {
      appearance: {
        outline:
          "border-[var(--py-border-default)] bg-[var(--py-surface-raised)] hover:bg-[var(--py-interaction-hover)]",
        ghost:
          "border-transparent bg-transparent hover:bg-[var(--py-interaction-hover)]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-[var(--py-profile-control-height)] px-4",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { appearance: "outline", size: "md" },
  },
);

/** Visual treatment for a two-state action. */
export type ToggleAppearance = NonNullable<
  VariantProps<typeof toggleClasses>["appearance"]
>;

/** Density choices for Toggle. */
export type ToggleSize = NonNullable<
  VariantProps<typeof toggleClasses>["size"]
>;

/** Props for the shared two-state button. */
export interface ToggleProps<Value extends string = string>
  extends Omit<BaseToggle.Props<Value>, "children" | "className"> {
  appearance?: ToggleAppearance;
  className?: string;
  /** Optional decorative icon shown before the persistent label. */
  icon?: ReactNode;
  /** Persistent visible label for the stateful action. */
  label: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  size?: ToggleSize;
}

/**
 * Persistent-label two-state button for view or formatting preferences.
 *
 * It supports outline/ghost appearances, three sizes, controlled or native
 * uncontrolled pressed state, and disabled state. Selection and focus use
 * semantic tokens across Public/Product and light/dark; Base UI owns
 * `aria-pressed`, Enter/Space, and group arrow-key behavior. Do expose a clear
 * stable label; don't use Toggle as a checkbox for submitted form data.
 */
export function Toggle<Value extends string = string>({
  appearance,
  className,
  icon,
  label,
  size,
  ...props
}: ToggleProps<Value>) {
  return (
    <BaseToggle
      {...props}
      className={toggleClasses({ appearance, className, size })}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </BaseToggle>
  );
}

/** Props for a labelled set of exclusive or multiple toggles. */
export interface ToggleGroupProps<Value extends string = string>
  extends Omit<BaseToggleGroup.Props<Value>, "className"> {
  className?: string;
  /** Accessible name for the grouped selection controls. */
  label: string;
  ref?: Ref<HTMLDivElement>;
}

/**
 * Groups related Toggles with native single- or multiple-selection behavior.
 *
 * Use `multiple`, orientation, controlled/default values, and disabled state
 * from Base UI. The group keeps one semantic surface across profiles/themes
 * and Base UI retains roving arrow-key focus, looping, and pressed state. Do
 * label the choice set; don't implement selection or focus in application code.
 */
export function ToggleGroup<Value extends string = string>({
  children,
  className,
  label,
  orientation = "horizontal",
  ...props
}: ToggleGroupProps<Value>) {
  return (
    <BaseToggleGroup
      {...props}
      aria-label={label}
      className={`inline-flex gap-1 rounded-[var(--py-radius-group)] bg-[var(--py-surface-subtle)] p-1 ${orientation === "vertical" ? "flex-col" : "flex-row"} ${className ?? ""}`}
      orientation={orientation}
    >
      {children}
    </BaseToggleGroup>
  );
}
