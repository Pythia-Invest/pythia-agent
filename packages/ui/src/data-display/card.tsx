import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../class-name";

/** Shared surface treatments for an ordinary content card. */
export type CardVariant = "raised" | "outlined" | "subtle";

/** Props for a grouped content surface with optional heading and footer regions. */
export interface CardProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  variant?: CardVariant;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
}

const variants: Record<CardVariant, string> = {
  raised: "border-transparent bg-container",
  outlined: "border-border bg-transparent",
  subtle: "border-transparent bg-subtle",
};

/**
 * Groups related content on a raised, outlined, or subtle surface with optional
 * title, description, and footer. Semantic surface and density aliases adapt it
 * across Public/Product and light/dark; it adds no focus or keyboard behavior.
 * Do use for one cohesive group; don't turn it into a workflow-specific
 * composite or nest cards for spacing alone.
 */
export function Card({
  variant = "raised",
  title,
  description,
  footer,
  children,
  className,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "grid gap-group rounded-container border p-4 public:p-6 text-body text-foreground leading-ui",
        variants[variant],
        className,
      )}
      data-slot="card"
      data-variant={variant}
      {...props}
    >
      {title || description ? (
        <div className="min-w-0" data-slot="card-header">
          {title ? (
            <div className="font-semibold text-reading leading-tight">
              {title}
            </div>
          ) : null}
          {description ? (
            <div className="mt-1 text-foreground-secondary">{description}</div>
          ) : null}
        </div>
      ) : null}
      <div className="min-w-0" data-slot="card-content">
        {children}
      </div>
      {footer ? (
        <div
          className="min-w-0 border-border border-t pt-3"
          data-slot="card-footer"
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
