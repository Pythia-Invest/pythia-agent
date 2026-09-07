"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { overlayClasses } from "./shared";

function PopoverPositioner({
  className,
  ...props
}: ComponentProps<typeof BasePopover.Positioner>) {
  return (
    <BasePopover.Positioner
      className={cnState(overlayClasses.positioner, className)}
      data-slot="popover-positioner"
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
      className={cnState(
        `${overlayClasses.surface} ${overlayClasses.floating}`,
        className,
      )}
      data-slot="popover-popup"
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
      className={cnState(overlayClasses.arrow, className)}
      data-slot="popover-arrow"
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
      className={cnState(overlayClasses.title, className)}
      data-slot="popover-title"
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
      className={cnState(overlayClasses.description, className)}
      data-slot="popover-description"
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
      className={cnState(overlayClasses.close, className)}
      data-slot="popover-close"
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
