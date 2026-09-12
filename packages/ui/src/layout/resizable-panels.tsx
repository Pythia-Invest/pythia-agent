"use client";

import {
  Group as NativeGroup,
  type GroupProps,
  Panel as NativePanel,
  type PanelProps,
  Separator as NativeSeparator,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "../class-name";

/** Props from react-resizable-panels v4 Group, including orientation and native layout callbacks. */
export interface ResizableGroupProps extends GroupProps {}

/**
 * Groups direct ResizablePanel and ResizableSeparator children horizontally or
 * vertically using react-resizable-panels v4. Native pointer, cursor, callback,
 * and keyboard resize behavior is retained; semantic styling works in
 * Public/Product and light/dark. Do keep panels and separators direct children;
 * don't wrap them in layout DOM or implement another resize state machine.
 */
export function ResizableGroup({ className, ...props }: ResizableGroupProps) {
  return (
    <NativeGroup
      className={cn(
        "min-h-0 min-w-0 overflow-hidden rounded-container border border-border",
        className,
      )}
      data-slot="resizable-group"
      {...props}
    />
  );
}

/** Props from react-resizable-panels v4 Panel, including native size constraints and callbacks. */
export interface ResizablePanelProps extends PanelProps {}

/**
 * Wraps one directly nested v4 Panel and forwards native default, minimum,
 * maximum, collapsible, resize, and imperative-ref props. Public/Product and
 * light/dark treatment is semantic while keyboard accessibility follows the
 * native group. Do use sizes with explicit units when intended; don't insert it
 * outside a ResizableGroup or add a DOM wrapper between them.
 */
export function ResizablePanel({ className, ...props }: ResizablePanelProps) {
  return (
    <NativePanel
      className={cn("min-h-0 min-w-0 bg-raised text-foreground", className)}
      data-slot="resizable-panel"
      {...props}
    />
  );
}

/** Props from the v4 Separator plus an optional visible grip, with native ARIA behavior preserved. */
export interface ResizableSeparatorProps extends SeparatorProps {
  withHandle?: boolean;
}

/**
 * Renders the direct v4 Separator between panels with an optional decorative
 * grip. Native pointer dragging, keyboard arrow/Home/End/Enter control,
 * double-click reset, ARIA values, and disabled state remain intact; tokens
 * adapt across Public/Product and light/dark. Do place it directly between
 * ResizablePanels; don't substitute the non-interactive content Separator.
 */
export function ResizableSeparator({
  className,
  withHandle = false,
  children,
  ...props
}: ResizableSeparatorProps) {
  return (
    <NativeSeparator
      className={cn(
        "group motion-fast relative grid flex-none place-items-center bg-border -outline-offset-2 transition-colors hover:bg-border-strong focus-visible:outline-2 focus-visible:outline-ring aria-[orientation=horizontal]:h-px aria-[orientation=vertical]:w-px data-[separator=active]:bg-border-strong",
        className,
      )}
      data-slot="resizable-separator"
      {...props}
    >
      {children}
      {withHandle ? (
        <span
          aria-hidden="true"
          className="absolute z-1 h-6 w-2 rounded-pill border border-border bg-raised group-aria-[orientation=horizontal]:h-2 group-aria-[orientation=horizontal]:w-6"
          data-slot="resizable-grip"
        />
      ) : null}
    </NativeSeparator>
  );
}
