/** Status tones shared by Alert, Badge and Toast; warning is never Signal Amber. */
export type StatusTone = "info" | "success" | "warning" | "error";

export const statusTones: Record<
  StatusTone,
  { surface: string; accent: string }
> = {
  info: {
    surface: "border-info-border bg-info-surface",
    accent: "text-info",
  },
  success: {
    surface: "border-success-border bg-success-surface",
    accent: "text-success",
  },
  warning: {
    surface: "border-warning-border bg-warning-surface",
    accent: "text-warning",
  },
  error: {
    surface: "border-error-border bg-error-surface",
    accent: "text-error",
  },
};
