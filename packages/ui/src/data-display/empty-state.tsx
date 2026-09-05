import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Props for a bounded empty-state explanation and optional next action. */
export interface EmptyStateProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/**
 * Explains an intentionally empty region with optional icon, description, and
 * next action. Semantic typography and surfaces adapt across Public/Product and
 * light/dark; reading order is native and actions retain their own keyboard
 * behavior. Do distinguish a valid empty result; don't use it for loading,
 * failure, or insufficient evidence.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={["py-empty-state", className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon ? (
        <div aria-hidden="true" className="py-empty-state__icon">
          {icon}
        </div>
      ) : null}
      <div className="py-empty-state__title">{title}</div>
      {description ? (
        <div className="py-empty-state__description">{description}</div>
      ) : null}
      {action ? <div className="py-empty-state__action">{action}</div> : null}
    </div>
  );
}
