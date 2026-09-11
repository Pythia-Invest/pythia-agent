"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { OverlayArrowShape, overlayArrowClasses } from "./arrow";
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
  children,
  className,
  ...props
}: ComponentProps<typeof BasePopover.Arrow>) {
  return (
    <BasePopover.Arrow
      className={cnState(
        `${overlayArrowClasses} ${overlayClasses.arrow}`,
        className,
      )}
      data-slot="popover-arrow"
      {...props}
    >
      {children ?? <OverlayArrowShape />}
    </BasePopover.Arrow>
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

/*
 * `render` means the caller brought their own styled component. Base UI's
 * mergeProps concatenates class names rather than tailwind-merging them, so
 * applying the close recipe on top would let its `bg-transparent`/`border-0`
 * beat that component's own variant on CSS source order alone. Style the bare
 * close affordance; step aside for a supplied one.
 */
function PopoverClose({
  className,
  render,
  ...props
}: ComponentProps<typeof BasePopover.Close>) {
  return (
    <BasePopover.Close
      className={render ? className : cnState(overlayClasses.close, className)}
      data-slot="popover-close"
      render={render}
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
