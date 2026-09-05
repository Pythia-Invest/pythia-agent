import type { ComponentPropsWithoutRef } from "react";

/** Maximum content measures supported by the shared Container. */
export type ContainerSize = "reading" | "content" | "wide" | "full";

/** Props for centered page-width containment with profile-aware gutters. */
export interface ContainerProps extends ComponentPropsWithoutRef<"div"> {
  size?: ContainerSize;
}

/**
 * Centers content within reading, content, wide, or full measure and applies
 * profile-aware page gutters. It uses shared geometry in Public/Product and is
 * light/dark-neutral, with no accessibility or keyboard behavior beyond its
 * native div. Do use as a page or section width boundary; don't use it as a
 * Card.
 */
export function Container({
  size = "content",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={["py-container", className].filter(Boolean).join(" ")}
      data-size={size}
      {...props}
    />
  );
}

/** Token-backed spacing steps shared by Stack and Inline. */
export type LayoutGap = "1" | "2" | "3" | "4" | "6" | "8";

/** Cross-axis alignment options shared by Stack and Inline. */
export type LayoutAlign = "start" | "center" | "end" | "stretch";

/** Props for a vertical composition with token-backed gap and alignment. */
export interface StackProps extends ComponentPropsWithoutRef<"div"> {
  gap?: LayoutGap;
  align?: LayoutAlign;
}

/**
 * Arranges repeated children vertically with a token-backed gap and alignment.
 * Spacing is shared across Public/Product and independent of light/dark; the
 * native div adds no semantics or keyboard behavior. Do use for repeated
 * vertical rhythm; don't use it to replace a meaningful list or field group.
 */
export function Stack({
  gap = "4",
  align = "stretch",
  className,
  ...props
}: StackProps) {
  return (
    <div
      className={["py-stack", className].filter(Boolean).join(" ")}
      data-align={align}
      data-gap={gap}
      {...props}
    />
  );
}

/** Props for a wrapping horizontal composition with token-backed gap and alignment. */
export interface InlineProps extends ComponentPropsWithoutRef<"div"> {
  gap?: LayoutGap;
  align?: LayoutAlign;
  wrap?: boolean;
}

/**
 * Arranges repeated children horizontally with optional wrapping, token-backed
 * gap, and alignment. It shares spacing across Public/Product and light/dark,
 * with no semantic, focus, or keyboard state. Do use for repeated peer controls
 * or labels; don't use it where native navigation/list structure is required.
 */
export function Inline({
  gap = "2",
  align = "center",
  wrap = true,
  className,
  ...props
}: InlineProps) {
  return (
    <div
      className={["py-inline", className].filter(Boolean).join(" ")}
      data-align={align}
      data-gap={gap}
      data-wrap={wrap ? "true" : "false"}
      {...props}
    />
  );
}
