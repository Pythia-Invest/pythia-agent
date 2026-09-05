import { clsx } from "clsx";
import type { ComponentProps } from "react";

function DetailsRoot({ className, ...props }: ComponentProps<"details">) {
  return <details className={clsx("py-details", className)} {...props} />;
}

function DetailsSummary({ className, ...props }: ComponentProps<"summary">) {
  return (
    <summary className={clsx("py-details-summary", className)} {...props} />
  );
}

function DetailsContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("py-details-content", className)} {...props} />;
}

/**
 * Native `details`/`summary` composition for document-like optional context.
 * Root exposes the platform `open` and toggle props with native open/closed
 * state; semantic borders, spacing, and interaction colors adapt across both
 * profiles and themes. The browser owns disclosure semantics, focus, and
 * keyboard Enter/Space activation without JavaScript. Use Summary before Content; do
 * not replace Accordion when coordinated or controlled sections are required.
 */
export const Details = {
  Root: DetailsRoot,
  Summary: DetailsSummary,
  Content: DetailsContent,
} as const;
