import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../class-name";
import { type StatusTone, statusTones } from "./tones";

/** Semantic badge treatments available in both profiles and themes. */
export type BadgeTone = "neutral" | StatusTone;

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
  const presentation =
    tone === "neutral"
      ? "border-border bg-subtle text-foreground-secondary"
      : cn(statusTones[tone].surface, statusTones[tone].accent);
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center whitespace-nowrap rounded-pill border px-2 font-semibold text-xs leading-ui",
        presentation,
        className,
      )}
      data-slot="badge"
      data-tone={tone}
      {...props}
    />
  );
}
