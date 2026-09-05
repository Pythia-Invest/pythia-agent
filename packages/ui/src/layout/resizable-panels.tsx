"use client";

import {
  Group as NativeGroup,
  type GroupProps,
  Panel as NativePanel,
  type PanelProps,
  Separator as NativeSeparator,
  type SeparatorProps,
} from "react-resizable-panels";

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
      className={["py-resizable-group", className].filter(Boolean).join(" ")}
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
      className={["py-resizable-panel", className].filter(Boolean).join(" ")}
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
      className={["py-resizable-separator", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
      {withHandle ? (
        <span aria-hidden="true" className="py-resizable-grip" />
      ) : null}
    </NativeSeparator>
  );
}
