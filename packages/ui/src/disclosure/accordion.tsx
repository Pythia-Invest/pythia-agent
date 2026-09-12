"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { disclosureClasses } from "./shared";

function AccordionRoot({
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Root>) {
  return (
    <BaseAccordion.Root
      className={cnState("text-foreground", className)}
      data-slot="accordion"
      {...props}
    />
  );
}

function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Item>) {
  return (
    <BaseAccordion.Item
      className={cnState("border-border border-b", className)}
      data-slot="accordion-item"
      {...props}
    />
  );
}

function AccordionHeader({
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Header>) {
  return (
    <BaseAccordion.Header
      className={cnState("m-0", className)}
      data-slot="accordion-header"
      {...props}
    />
  );
}

function AccordionTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Trigger>) {
  return (
    <BaseAccordion.Trigger
      className={cnState(
        `group ${disclosureClasses.trigger} hover:underline hover:underline-offset-[0.2em] data-disabled:cursor-not-allowed data-disabled:opacity-disabled`,
        className,
      )}
      data-slot="accordion-trigger"
      {...props}
    >
      <span>{children}</span>
      <ChevronDown
        aria-hidden="true"
        className={`${disclosureClasses.icon} group-data-panel-open:rotate-180`}
        data-slot="accordion-icon"
      />
    </BaseAccordion.Trigger>
  );
}

function AccordionPanel({
  children,
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Panel>) {
  return (
    <BaseAccordion.Panel
      className={cnState(
        `${disclosureClasses.panel} h-[var(--accordion-panel-height,auto)]`,
        className,
      )}
      data-slot="accordion-panel"
      {...props}
    >
      <div
        className={disclosureClasses.content}
        data-slot="accordion-panel-content"
      >
        {children}
      </div>
    </BaseAccordion.Panel>
  );
}

/**
 * Related disclosure sections with single or multiple expansion.
 * Root and Item retain Base UI value, defaultValue, multiple, disabled,
 * keepMounted, and hidden-until-found props; native open/disabled states use
 * item separators and rotating chevrons across profiles and themes. Base UI owns
 * button semantics, `aria-expanded`/panel linkage, and keyboard activation.
 * Use for peer sections; do not store product workflow state in the component.
 */
export const Accordion = {
  Root: AccordionRoot,
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Panel: AccordionPanel,
} as const;
