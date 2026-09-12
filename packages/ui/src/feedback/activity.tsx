import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../class-name";

/** Props for non-quantified activity, including its required accessible label and display size. */
export interface ActivityIndicatorProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  label: string;
  size?: "small" | "medium";
  visuallyHiddenLabel?: boolean;
}

/**
 * Announces ongoing indeterminate activity without inventing a completion
 * percentage. Its neutral action treatment adapts to Public/Product and
 * light/dark, respects reduced motion, and exposes a polite status label with no
 * keyboard interaction. Do use when duration is unknown; don't use it for a
 * known quantitative task or omit the label.
 */
export function ActivityIndicator({
  label,
  size = "medium",
  visuallyHiddenLabel = false,
  className,
  ...props
}: ActivityIndicatorProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 text-body text-foreground-secondary leading-ui",
        className,
      )}
      data-size={size}
      data-slot="activity-indicator"
      role="status"
      {...props}
    >
      <LoaderCircle
        aria-hidden="true"
        className={cn(
          "animate-spin-slow motion-reduce:animate-none",
          size === "small" ? "size-4" : "size-5",
        )}
      />
      <span className={visuallyHiddenLabel ? "sr-only" : undefined}>
        {label}
      </span>
    </div>
  );
}
