import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/** Status meanings available to Alert in every profile and theme. */
export type AlertTone = "info" | "success" | "warning" | "error";

/** Props for the shared status message, including its tone, title, and optional detail or action. */
export interface AlertProps
  extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  tone?: AlertTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}

const icons = {
  info: Info,
  success: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
} as const;

/**
 * Presents compact, transient interface status with a labelled info, success,
 * warning, or error meaning plus optional detail and action. Semantic tokens keep meanings consistent in Public/Product
 * and light/dark; an icon and label supplement color. Error is assertive while
 * other tones are polite, with no added keyboard interaction. Do use for a
 * meaningful status; use SemanticMessage for a durable labelled inline
 * explanation. Don't use as ordinary decoration or as a Pythia signal.
 */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
  role,
  ...props
}: AlertProps) {
  const Icon = icons[tone];
  return (
    <div
      className={["py-alert", className].filter(Boolean).join(" ")}
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    >
      <Icon aria-hidden="true" className="py-alert__icon" />
      <div className="py-alert__content">
        <div className="py-alert__title">{title}</div>
        {children ? (
          <div className="py-alert__description">{children}</div>
        ) : null}
      </div>
      {action ? <div className="py-alert__action">{action}</div> : null}
    </div>
  );
}
