import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../class-name";

/** Placeholder shapes supported by Skeleton in each profile and theme. */
export type SkeletonShape = "text" | "block" | "circle";

/** Props for a decorative loading placeholder, including shape and native div attributes. */
export interface SkeletonProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  shape?: SkeletonShape;
}

const shapes: Record<SkeletonShape, string> = {
  text: "h-[0.8em] rounded-pill",
  block: "min-h-4 rounded-control",
  circle: "size-10 rounded-full",
};

/**
 * Reserves visual space while nearby content loads using text, block, or circle
 * shape. Public/Product density and light/dark surfaces come from semantic tokens;
 * shimmer respects reduced motion and the placeholder stays out of the
 * accessibility tree and keyboard order. Do pair it with a separately labelled
 * loading region; don't use it as the activity announcement itself.
 */
export function Skeleton({
  shape = "text",
  className,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-subtle after:absolute after:inset-0 after:-translate-x-full after:animate-shimmer after:bg-linear-to-r after:from-subtle after:via-interaction-hover after:to-subtle after:content-[''] motion-reduce:after:animate-none",
        shapes[shape],
        className,
      )}
      data-shape={shape}
      data-slot="skeleton"
      {...props}
      aria-hidden="true"
    />
  );
}
