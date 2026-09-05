"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { mergeClassName } from "./class-names";

function PopoverPositioner({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Positioner>) {
  return (
    <BasePopover.Positioner
      className={mergeClassName("py-floating-positioner", className)}
      sideOffset={8}
      {...props}
    />
  );
}

function PopoverPopup({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Popup>) {
  return (
    <BasePopover.Popup
      className={mergeClassName(
        "py-floating-popup py-popover-popup",
        className,
      )}
      {...props}
    />
  );
}

function PopoverArrow({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Arrow>) {
  return (
    <BasePopover.Arrow
      className={mergeClassName("py-floating-arrow", className)}
      {...props}
    />
  );
}

function PopoverTitle({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Title>) {
  return (
    <BasePopover.Title
      className={mergeClassName("py-overlay-title", className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Description>) {
  return (
    <BasePopover.Description
      className={mergeClassName("py-overlay-description", className)}
      {...props}
    />
  );
}

function PopoverClose({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Close>) {
  return (
    <BasePopover.Close
      className={mergeClassName("py-overlay-close", className)}
      {...props}
    />
  );
}

/**
 * Anchored interactive popup for compact controls or supporting content.
 * Base UI Root and Positioner expose controlled open, modal, alignment, side,
 * collision, and dismissal props; open/closed/side states style the same raised
 * semantic surface across profiles and themes. Base UI owns focus placement
 * and restoration, keyboard Escape/outside press, portal, and accessible title and
 * description wiring. Use for interactive content; do not use as a tooltip.
 */
export const Popover = {
  Root: BasePopover.Root,
  Trigger: BasePopover.Trigger,
  Portal: BasePopover.Portal,
  Backdrop: BasePopover.Backdrop,
  Positioner: PopoverPositioner,
  Viewport: BasePopover.Viewport,
  Popup: PopoverPopup,
  Arrow: PopoverArrow,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Close: PopoverClose,
} as const;
