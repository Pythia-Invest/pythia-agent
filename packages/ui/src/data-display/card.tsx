import type { ComponentPropsWithoutRef, ReactNode } from "react";

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
      className={["py-card", className].filter(Boolean).join(" ")}
      data-variant={variant}
      {...props}
    >
      {title || description ? (
        <div className="py-card__header">
          {title ? <div className="py-card__title">{title}</div> : null}
          {description ? (
            <div className="py-card__description">{description}</div>
          ) : null}
        </div>
      ) : null}
      <div className="py-card__content">{children}</div>
      {footer ? <div className="py-card__footer">{footer}</div> : null}
    </div>
  );
}
