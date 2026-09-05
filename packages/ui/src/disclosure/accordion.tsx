"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { mergeClassName } from "../overlays/class-names";

function AccordionRoot({
  className,
  ...props
}: ComponentProps<typeof BaseAccordion.Root>) {
  return (
    <BaseAccordion.Root
      className={mergeClassName("py-accordion", className)}
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
      className={mergeClassName("py-accordion-item", className)}
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
      className={mergeClassName("py-accordion-header", className)}
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
      className={mergeClassName("py-accordion-trigger", className)}
      {...props}
    >
      <span>{children}</span>
      <ChevronDown aria-hidden="true" className="py-accordion-icon" />
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
      className={mergeClassName("py-accordion-panel", className)}
      {...props}
    >
      <div className="py-accordion-panel-content">{children}</div>
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
