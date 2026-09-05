import type { ComponentPropsWithoutRef } from "react";

/** Placeholder shapes supported by Skeleton in each profile and theme. */
export type SkeletonShape = "text" | "block" | "circle";

/** Props for a decorative loading placeholder, including shape and native div attributes. */
export interface SkeletonProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  shape?: SkeletonShape;
}

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
      className={["py-skeleton", className].filter(Boolean).join(" ")}
      data-shape={shape}
      {...props}
      aria-hidden="true"
    />
  );
}
