"use client";

import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { overlayClasses } from "./shared";

function PreviewCardPositioner({
  className,
  ...props
}: ComponentProps<typeof BasePreviewCard.Positioner>) {
  return (
    <BasePreviewCard.Positioner
      className={cnState(overlayClasses.positioner, className)}
      data-slot="preview-card-positioner"
      sideOffset={8}
      {...props}
    />
  );
}

function PreviewCardPopup({
  className,
  ...props
}: ComponentProps<typeof BasePreviewCard.Popup>) {
  return (
    <BasePreviewCard.Popup
      className={cnState(
        `${overlayClasses.surface} ${overlayClasses.floating}`,
        className,
      )}
      data-slot="preview-card-popup"
      {...props}
    />
  );
}

function PreviewCardArrow({
  className,
  ...props
}: ComponentProps<typeof BasePreviewCard.Arrow>) {
  return (
    <BasePreviewCard.Arrow
      className={cnState(overlayClasses.arrow, className)}
      data-slot="preview-card-arrow"
      {...props}
    />
  );
}

/**
 * Hover/focus preview card for richer, non-essential context about a trigger.
 * Base UI Root and Positioner retain controlled-open, delay, side, alignment,
 * and collision props; native open/closed/side states style a raised surface in
 * every profile and theme. Base UI owns hover intent, keyboard focus coordination,
 * Escape/outside dismissal, portal, and safe pointer travel between trigger
 * and card. Use supplemental previews; do not hide required task controls here.
 */
export const PreviewCard = {
  Root: BasePreviewCard.Root,
  Trigger: BasePreviewCard.Trigger,
  Portal: BasePreviewCard.Portal,
  Backdrop: BasePreviewCard.Backdrop,
  Positioner: PreviewCardPositioner,
  Viewport: BasePreviewCard.Viewport,
  Popup: PreviewCardPopup,
  Arrow: PreviewCardArrow,
} as const;

/**
 * Familiar HoverCard alias for the same Base UI Preview Card implementation.
 * It preserves the same open/delay/position props, native focus and pointer
 * behavior, open/closed states, and Public/Product plus light/dark treatment.
 * Keyboard users receive the preview through the trigger's native focus path.
 * Use whichever name is clearest in a composition; do not fork its behavior or
 * use the alias for essential interactive content.
 */
export const HoverCard = PreviewCard;
