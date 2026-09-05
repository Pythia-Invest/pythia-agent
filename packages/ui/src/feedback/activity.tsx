import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

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
      className={["py-activity", className].filter(Boolean).join(" ")}
      data-size={size}
      role="status"
      {...props}
    >
      <LoaderCircle aria-hidden="true" className="py-activity__icon" />
      <span className={visuallyHiddenLabel ? "py-visually-hidden" : undefined}>
        {label}
      </span>
    </div>
  );
}
