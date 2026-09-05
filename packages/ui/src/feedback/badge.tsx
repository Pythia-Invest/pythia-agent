import type { ComponentPropsWithoutRef } from "react";

/** Semantic badge treatments available in both profiles and themes. */
export type BadgeTone = "neutral" | "info" | "success" | "warning" | "error";

/** Props for a compact textual badge, including semantic tone and native span attributes. */
export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
}

/**
 * Labels a compact category or supplied status with neutral, info, success,
 * warning, or error treatment. It uses the same semantic tokens in Public and
 * Product across light/dark and always retains visible text, so it needs no
 * keyboard behavior. Do provide a short label; don't encode state through color
 * alone or use warning as Pythia Signal Amber.
 */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={["py-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
      {...props}
    />
  );
}
