"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { overlayClasses } from "./shared";

function TooltipPositioner({
  className,
  ...props
}: ComponentProps<typeof BaseTooltip.Positioner>) {
  return (
    <BaseTooltip.Positioner
      className={cnState(overlayClasses.positioner, className)}
      data-slot="tooltip-positioner"
      sideOffset={6}
      {...props}
    />
  );
}

function TooltipPopup({
  className,
  ...props
}: ComponentProps<typeof BaseTooltip.Popup>) {
  return (
    <BaseTooltip.Popup
      className={cnState(
        "motion-fast z-60 max-w-[min(18rem,calc(100vw-2rem))] rounded-control bg-foreground px-2 py-1 text-canvas text-xs leading-ui transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="tooltip-popup"
      {...props}
    />
  );
}

function TooltipArrow({
  className,
  ...props
}: ComponentProps<typeof BaseTooltip.Arrow>) {
  return (
    <BaseTooltip.Arrow
      className={cnState("fill-foreground", className)}
      data-slot="tooltip-arrow"
      {...props}
    />
  );
}

/**
 * Brief, non-interactive explanation associated with a trigger.
 * Provider and Root retain Base UI delay, controlled-open, hoverability, and
 * cursor-tracking props; open/closed/side states use compact semantic styling
 * in Public/Product and light/dark. Base UI owns hover/keyboard focus coordination,
 * Escape dismissal, portal, positioning, and the trigger description link.
 * Use concise supplementary text; do not place actions or essential content in it.
 */
export const Tooltip = {
  Provider: BaseTooltip.Provider,
  Root: BaseTooltip.Root,
  Trigger: BaseTooltip.Trigger,
  Portal: BaseTooltip.Portal,
  Positioner: TooltipPositioner,
  Viewport: BaseTooltip.Viewport,
  Popup: TooltipPopup,
  Arrow: TooltipArrow,
} as const;
