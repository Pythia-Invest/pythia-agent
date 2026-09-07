import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../class-name";
import { type StatusTone, statusTones } from "./tones";

/** Status meanings available to Alert in every profile and theme. */
export type AlertTone = StatusTone;

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
  const presentation = statusTones[tone];
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-container border px-4 py-3 text-body text-foreground leading-ui",
        presentation.surface,
        className,
      )}
      data-slot="alert"
      data-tone={tone}
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-[1.125rem]", presentation.accent)}
      />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        {children ? (
          <div className="mt-1 text-foreground-secondary">{children}</div>
        ) : null}
      </div>
      {action ? <div className="self-center">{action}</div> : null}
    </div>
  );
}
