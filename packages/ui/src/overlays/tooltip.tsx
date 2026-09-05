"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ComponentProps } from "react";
import { mergeClassName } from "./class-names";

function TooltipPositioner({
  className,
  ...props
}: ComponentProps<typeof BaseTooltip.Positioner>) {
  return (
    <BaseTooltip.Positioner
      className={mergeClassName("py-floating-positioner", className)}
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
      className={mergeClassName("py-tooltip-popup", className)}
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
      className={mergeClassName("py-tooltip-arrow", className)}
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
