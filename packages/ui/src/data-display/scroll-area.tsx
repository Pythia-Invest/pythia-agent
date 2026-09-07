"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ReactNode } from "react";
import { cn } from "../class-name";

/** Scrollbar axes rendered by the shared ScrollArea. */
export type ScrollAreaOrientation = "vertical" | "horizontal" | "both";

/** Props for an overflow viewport using Base UI's native scrollbar behavior. */
export interface ScrollAreaProps {
  children: ReactNode;
  orientation?: ScrollAreaOrientation;
  className?: string;
  viewportClassName?: string;
}

const scrollbar =
  "flex touch-none select-none bg-subtle p-0.5 data-[orientation=horizontal]:h-3 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-3";
const thumb = "min-h-4 min-w-4 rounded-pill bg-border-strong";

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
      className={cn(
        "relative overflow-hidden rounded-container border border-border bg-raised text-foreground",
        className,
      )}
      data-slot="scroll-area"
    >
      <BaseScrollArea.Viewport
        className={cn("size-full overscroll-contain", viewportClassName)}
        data-slot="scroll-area-viewport"
      >
        <BaseScrollArea.Content className="min-w-full">
          {children}
        </BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
      {vertical ? (
        <BaseScrollArea.Scrollbar className={scrollbar} orientation="vertical">
          <BaseScrollArea.Thumb className={thumb} />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {horizontal ? (
        <BaseScrollArea.Scrollbar
          className={scrollbar}
          orientation="horizontal"
        >
          <BaseScrollArea.Thumb className={thumb} />
        </BaseScrollArea.Scrollbar>
      ) : null}
      {orientation === "both" ? (
        <BaseScrollArea.Corner className="bg-subtle" />
      ) : null}
    </BaseScrollArea.Root>
  );
}
