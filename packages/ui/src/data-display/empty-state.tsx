import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../class-name";

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
      className={cn(
        "grid place-items-center gap-2 rounded-container border border-border border-dashed bg-subtle px-4 public:py-12 py-8 text-center text-body text-foreground leading-ui",
        className,
      )}
      data-slot="empty-state"
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="grid size-12 place-items-center text-foreground-secondary [&>svg]:size-8"
        >
          {icon}
        </div>
      ) : null}
      <div className="font-semibold text-reading">{title}</div>
      {description ? (
        <div className="max-w-measure text-foreground-secondary">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
