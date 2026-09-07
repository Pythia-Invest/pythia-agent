import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../class-name";

/** Maximum content measures supported by the shared Container. */
export type ContainerSize = "reading" | "content" | "wide" | "full";

/** Props for centered page-width containment with profile-aware gutters. */
export interface ContainerProps extends ComponentPropsWithoutRef<"div"> {
  size?: ContainerSize;
}

const containerSizes: Record<ContainerSize, string> = {
  reading: "max-w-[calc(var(--container-measure)+2*var(--spacing-gutter))]",
  content: "max-w-[calc(1.5*var(--container-measure)+2*var(--spacing-gutter))]",
  wide: "max-w-[calc(2*var(--container-measure)+2*var(--spacing-gutter))]",
  full: "max-w-none",
};

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
      className={cn(
        "mx-auto w-full px-gutter",
        containerSizes[size],
        className,
      )}
      data-size={size}
      data-slot="container"
      {...props}
    />
  );
}

/** Token-backed spacing steps shared by Stack and Inline. */
export type LayoutGap = "1" | "2" | "3" | "4" | "6" | "8";

/** Cross-axis alignment options shared by Stack and Inline. */
export type LayoutAlign = "start" | "center" | "end" | "stretch";

const gaps: Record<LayoutGap, string> = {
  "1": "gap-1",
  "2": "gap-2",
  "3": "gap-3",
  "4": "gap-4",
  "6": "gap-6",
  "8": "gap-8",
};

const alignments: Record<LayoutAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

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
      className={cn("flex flex-col", gaps[gap], alignments[align], className)}
      data-slot="stack"
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
      className={cn(
        "flex flex-row",
        wrap && "flex-wrap",
        gaps[gap],
        alignments[align],
        className,
      )}
      data-slot="inline"
      {...props}
    />
  );
}
