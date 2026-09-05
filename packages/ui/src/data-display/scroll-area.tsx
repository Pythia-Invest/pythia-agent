"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode } from "react";

/** Scrollbar axes rendered by the shared ScrollArea. */
export type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

/** Props for an overflow viewport using Base UI's native scrollbar behavior. */
export interface ScrollAreaProps {
  children: ReactNode;
  orientation?: ScrollAreaOrientation;
  className?: string;
  viewportClassName?: string;
}

/**
 * Contains overflow with vertical, horizontal, or both Base UI scrollbars.
 * Native measurement, pointer dragging, touch scrolling, and keyboard scrolling
 * remain intact; semantic track/thumb tokens adapt in Public/Product and
 * light/dark. Do give the root a constrained size in context; don't use it to
 * hide content that should participate in normal page flow.
 */
export function ScrollArea({
  children,
  orientation = "vertical",
  className,
  viewportClassName,
}: ScrollAreaProps) {
  const horizontal = orientation === "horizontal" || orientation === "both";
  const vertical = orientation === "vertical" || orientation === "both";
  return (
    <BaseScrollArea.Root
      className={["py-scroll-area", className].filter(Boolean).join(" ")}
    >
      <BaseScrollArea.Viewport
        className={["py-scroll-area__viewport", viewportClassName]
          .filter(Boolean)
          .join(" ")}
      >
        <BaseScrollArea.Content className="py-scroll-area__content">
          {children}
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      {vertical ? (
        <BaseScrollArea.Scrollbar
          className="py-scroll-area__scrollbar"
          orientation="vertical"
        >
          <BaseScrollArea.Thumb className="py-scroll-area__thumb" />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {horizontal ? (
        <BaseScrollArea.Scrollbar
          className="py-scroll-area__scrollbar"
          orientation="horizontal"
        >
          <BaseScrollArea.Thumb className="py-scroll-area__thumb" />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {orientation === "both" ? (
        <BaseScrollArea.Corner className="py-scroll-area__corner" />
      ) : null}
    </BaseScrollArea.Root>
  );
}
