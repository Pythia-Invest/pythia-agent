"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, ReactNode, Ref } from "react";
import { cn } from "../class-name";

const buttonClasses = cva(
  "motion-fast motion-reduce:translate-none motion-reduce:active:translate-none inline-flex shrink-0 items-center justify-center gap-2 rounded-control border font-semibold text-sm leading-none transition-[background-color,border-color,color,opacity,translate] active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-disabled motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary text-primary-foreground hover:opacity-85 active:opacity-75",
        secondary:
          "border-border bg-raised text-foreground hover:bg-interaction-hover active:bg-interaction-active",
        ghost:
          "border-transparent bg-transparent text-foreground hover:bg-interaction-hover active:bg-interaction-active",
        danger:
          "border-error-border bg-error-surface text-error hover:opacity-85 active:opacity-75",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-control px-4",
        lg: "h-12 px-5 text-base",
      },
    },
    defaultVariants: { size: "md", variant: "primary" },
  },
);

/** Semantic action hierarchy shared by buttons and button-styled links. */
export type ButtonVariant = NonNullable<
  VariantProps<typeof buttonClasses>["variant"]
>;

/** Density choices for ordinary actions across Public and Product profiles. */
export type ButtonSize = NonNullable<
  VariantProps<typeof buttonClasses>["size"]
>;

interface ButtonStyleOptions {
  className?: string | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}

function getButtonClassName({ className, size, variant }: ButtonStyleOptions) {
  return cn(buttonClasses({ size, variant }), className);
}

const spinner = (
  <span
    aria-hidden="true"
    className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
  />
);

/** Props for the shared labelled action button. */
export interface ButtonProps
  extends Omit<BaseButton.Props, "children" | "className"> {
  children: ReactNode;
  className?: string;
  /** Disables activation and exposes busy state without taking the label away. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

/**
 * Labelled button for ordinary actions in Public and Product surfaces.
 *
 * Use `primary`, `secondary`, `ghost`, or `danger` hierarchy at `sm`, `md`, or
 * `lg` size. Loading keeps the persistent label, sets busy state, and disables
 * activation; native disabled and button keyboard behavior come from Base UI.
 * Semantic tokens adapt every variant to light/dark and both density profiles.
 * Do use this for actions; don't use it for navigation or hide its label.
 */
export function Button({
  children,
  className,
  disabled,
  loading = false,
  size,
  variant,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      aria-busy={loading || undefined}
      className={getButtonClassName({ className, size, variant })}
      data-slot="button"
      disabled={disabled || loading}
    >
      {loading ? spinner : null}
      {children}
    </BaseButton>
  );
}

/** Props for a square, accessible icon-only action. */
export interface IconButtonProps
  extends Omit<ButtonProps, "children" | "size"> {
  children: ReactNode;
  /** Required accessible name; no visible label is rendered. */
  label: string;
  size?: ButtonSize;
}

const iconButtonSizes: Record<ButtonSize, string> = {
  sm: "size-8",
  md: "size-control",
  lg: "size-12",
};

/**
 * Compact icon-only button for familiar actions where space is constrained.
 *
 * It supports the Button variants, sizes, disabled, and loading states; `label`
 * is always its accessible name. Semantic tokens cover Public/Product and both
 * themes, while Base UI retains native Enter/Space and disabled behavior. Do
 * use a recognizable icon with a precise label; don't use it for an unfamiliar
 * action that needs persistent visible text.
 */
export function IconButton({
  children,
  className,
  label,
  loading = false,
  size = "md",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <BaseButton
      {...props}
      aria-busy={loading || undefined}
      aria-label={label}
      className={getButtonClassName({
        className: cn(iconButtonSizes[size], "p-0", className),
        size,
        variant,
      })}
      data-slot="icon-button"
      disabled={props.disabled || loading}
    >
      {loading ? (
        spinner
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex size-4 items-center justify-center [&>svg]:size-4"
        >
          {children}
        </span>
      )}
    </BaseButton>
  );
}

/** Props for a labelled group of related actions. */
export interface ButtonGroupProps extends ComponentPropsWithRef<"fieldset"> {
  /** Accessible name for the related action set. */
  label: string;
  orientation?: "horizontal" | "vertical";
}

/**
 * Groups related buttons into one labelled visual and accessibility unit.
 *
 * Horizontal and vertical orientations share semantic borders in both themes
 * and profiles; child buttons retain their own disabled/loading states and
 * native keyboard behavior. Do group genuinely related actions; don't use the
 * group as a selection control (use ToggleGroup for that).
 */
export function ButtonGroup({
  children,
  className,
  label,
  orientation = "horizontal",
  ...props
}: ButtonGroupProps) {
  return (
    <fieldset
      {...props}
      aria-label={label}
      className={cn(
        "m-0 inline-flex min-w-0 border-0 p-0",
        orientation === "vertical"
          ? "flex-col [&>*:not(:first-child)]:-mt-px [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none"
          : "flex-row [&>*:not(:first-child)]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none",
        className,
      )}
      data-orientation={orientation}
      data-slot="button-group"
    >
      {children}
    </fieldset>
  );
}

/** Props for an anchor presented with ordinary button hierarchy. */
export interface LinkButtonProps
  extends Omit<ComponentPropsWithRef<"a">, "className" | "href"> {
  className?: string;
  /** Application-owned, prevalidated navigation destination. */
  href: string;
  size?: ButtonSize;
  variant?: Exclude<ButtonVariant, "danger">;
}

/**
 * Button-styled anchor for navigation that needs action-like emphasis.
 *
 * It supports primary, secondary, and ghost hierarchy plus all three sizes;
 * semantic tokens adapt it across profiles and themes. The native anchor owns
 * focus, Enter activation, destination, and browser behaviors. Do provide a
 * safe application-owned `href`; don't use this component for mutations.
 */
export function LinkButton({
  className,
  size,
  variant,
  ...props
}: LinkButtonProps) {
  return (
    <a
      {...props}
      className={cn(
        getButtonClassName({ size, variant }),
        "no-underline",
        className,
      )}
      data-slot="link-button"
    />
  );
}
