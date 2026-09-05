"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { mergeClassName } from "../overlays/class-names";

function CollapsibleRoot({
  className,
  disabled,
  ...props
}: ComponentProps<typeof BaseCollapsible.Root>) {
  return (
    <BaseCollapsible.Root
      className={mergeClassName("py-collapsible", className)}
      data-disabled={disabled ? "" : undefined}
      disabled={disabled}
      {...props}
    />
  );
}

function CollapsibleTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof BaseCollapsible.Trigger>) {
  return (
    <BaseCollapsible.Trigger
      className={mergeClassName("py-collapsible-trigger", className)}
      {...props}
    >
      <span>{children}</span>
      <ChevronDown aria-hidden="true" className="py-collapsible-icon" />
    </BaseCollapsible.Trigger>
  );
}

function CollapsiblePanel({
  children,
  className,
  ...props
}: ComponentProps<typeof BaseCollapsible.Panel>) {
  return (
    <BaseCollapsible.Panel
      className={mergeClassName("py-collapsible-panel", className)}
      {...props}
    >
      <div className="py-collapsible-panel-content">{children}</div>
    </BaseCollapsible.Panel>
  );
}

/**
 * One independently expandable disclosure region.
 * Root retains Base UI controlled/default open and disabled props; native
 * open/closed transition states receive a single bordered-container treatment
 * in Public/Product and light/dark; disabled fades the complete composition
 * once. Base UI owns button semantics,
 * `aria-expanded`/panel linkage, focus, and keyboard activation. Use for a
 * single optional region; do not use it as hidden application workflow state.
 */
export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
} as const;
