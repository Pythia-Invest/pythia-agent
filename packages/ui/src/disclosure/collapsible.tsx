"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { disclosureClasses } from "./shared";

function CollapsibleRoot({
  className,
  disabled,
  ...props
}: ComponentProps<typeof BaseCollapsible.Root>) {
  return (
    <BaseCollapsible.Root
      className={cnState(
        "overflow-hidden rounded-container border border-border bg-raised text-foreground data-disabled:opacity-disabled",
        className,
      )}
      data-disabled={disabled ? "" : undefined}
      data-slot="collapsible"
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
      className={cnState(
        `group ${disclosureClasses.trigger} px-4 hover:bg-interaction-hover disabled:cursor-not-allowed`,
        className,
      )}
      data-slot="collapsible-trigger"
      {...props}
    >
      <span>{children}</span>
      <ChevronDown
        aria-hidden="true"
        className={`${disclosureClasses.icon} group-data-panel-open:rotate-180`}
        data-slot="collapsible-icon"
      />
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
      className={cnState(
        `${disclosureClasses.panel} h-[var(--collapsible-panel-height,auto)]`,
        className,
      )}
      data-slot="collapsible-panel"
      {...props}
    >
      <div
        className={`${disclosureClasses.content} border-border border-t p-4`}
        data-slot="collapsible-panel-content"
      >
        {children}
      </div>
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
