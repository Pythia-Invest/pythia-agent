import type { ComponentProps } from "react";
import { cn } from "../class-name";
import { disclosureClasses } from "./shared";

function DetailsRoot({ className, ...props }: ComponentProps<"details">) {
  return (
    <details
      className={cn(
        "group/details border-border border-y text-foreground",
        className,
      )}
      data-slot="details"
      {...props}
    />
  );
}

function DetailsSummary({ className, ...props }: ComponentProps<"summary">) {
  return (
    <summary
      className={cn(
        disclosureClasses.trigger,
        "after:motion-fast list-none after:flex-none after:font-normal after:text-foreground-secondary after:transition-transform after:content-['+'] hover:bg-interaction-hover group-open/details:after:rotate-45 [&::-webkit-details-marker]:hidden",
        className,
      )}
      data-slot="details-summary"
      {...props}
    />
  );
}

function DetailsContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(disclosureClasses.content, className)}
      data-slot="details-content"
      {...props}
    />
  );
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
