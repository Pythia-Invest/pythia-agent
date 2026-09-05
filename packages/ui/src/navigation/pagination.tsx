import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import type { ComponentProps } from "react";
import { joinClassNames } from "./class-name";

export type PaginationProps = ComponentProps<"nav">;

/**
 * Landmark containing application-owned links between result pages.
 *
 * Native nav props pass through with a default “Pagination” label. It has no
 * internal page state; profile density and light/dark treatment live on its
 * children. Browser link focus and keyboard behavior remain native. Supply
 * real page URLs and counts from the app; do not fetch or paginate data here.
 */
export function Pagination({
  "aria-label": ariaLabel = "Pagination",
  className,
  ...props
}: PaginationProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={joinClassNames("pythia-pagination", className)}
      {...props}
    />
  );
}

export type PaginationListProps = ComponentProps<"ul">;

/**
 * Unordered list containing pagination controls.
 *
 * Native list props pass through; spacing and wrapping use profile aliases and
 * semantic theme tokens. List structure remains exposed to assistive
 * technology. Use `PaginationItem` children; do not put ungrouped controls
 * directly in the navigation landmark.
 */
export function PaginationList({ className, ...props }: PaginationListProps) {
  return (
    <ul
      className={joinClassNames("pythia-pagination__list", className)}
      {...props}
    />
  );
}

export type PaginationItemProps = ComponentProps<"li">;

/**
 * Semantic list item wrapping one pagination link or omission marker.
 *
 * Native list-item props pass through and it has no state or theme fork.
 * Assistive technology retains list structure while focus stays on the child
 * link. Use one control per item; do not make the list item interactive.
 */
export function PaginationItem({ className, ...props }: PaginationItemProps) {
  return (
    <li
      className={joinClassNames("pythia-pagination__item", className)}
      {...props}
    />
  );
}

export interface PaginationLinkProps extends ComponentProps<"a"> {
  /** Marks this URL as the current page and applies neutral selection styling. */
  current?: boolean;
}

/**
 * Native page link with optional current-page semantics.
 *
 * Anchor props and app-owned `href` pass through; `current` adds
 * `aria-current="page"` and neutral selection tokens. Public/Product sizing
 * and light/dark colors are semantic. Browser link focus/activation remains
 * native. Use `current` for exactly one page; do not store page state here.
 */
export function PaginationLink({
  "aria-current": ariaCurrent,
  className,
  current = false,
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={current ? "page" : ariaCurrent}
      className={joinClassNames("pythia-pagination__link", className)}
      data-current={current ? "" : undefined}
      {...props}
    />
  );
}

export type PaginationPreviousProps = PaginationLinkProps;

/**
 * Pagination link to the preceding page.
 *
 * It shares `PaginationLink` props, including app-owned `href` and optional
 * current state, and adds a directional icon plus default accessible wording.
 * Tokens handle profiles/themes; native anchor keyboard behavior is retained.
 * Override visible text when useful; do not calculate the prior URL here.
 */
export function PaginationPrevious({
  children = "Previous",
  ...props
}: PaginationPreviousProps) {
  return (
    <PaginationLink aria-label="Go to previous page" {...props}>
      <ChevronLeft aria-hidden="true" />
      <span>{children}</span>
    </PaginationLink>
  );
}

export type PaginationNextProps = PaginationLinkProps;

/**
 * Pagination link to the following page.
 *
 * It shares `PaginationLink` props, including app-owned `href`, and adds a
 * directional icon plus default accessible wording. Semantic tokens adapt to
 * profiles/themes and native anchor keyboard behavior remains intact. Override
 * visible text when useful; do not calculate the next URL here.
 */
export function PaginationNext({
  children = "Next",
  ...props
}: PaginationNextProps) {
  return (
    <PaginationLink aria-label="Go to next page" {...props}>
      <span>{children}</span>
      <ChevronRight aria-hidden="true" />
    </PaginationLink>
  );
}

export type PaginationEllipsisProps = ComponentProps<"span">;

/**
 * Non-interactive marker for an omitted run of page links.
 *
 * Native span props pass through, with a default visually hidden “More pages”
 * label. It uses secondary semantic text in Public/Product and light/dark and
 * is not a keyboard stop. Use between reachable page ranges; do not substitute
 * it for an unknown total.
 */
export function PaginationEllipsis({
  children,
  className,
  ...props
}: PaginationEllipsisProps) {
  return (
    <span
      className={joinClassNames("pythia-pagination__ellipsis", className)}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" />
      <span className="pythia-visually-hidden">{children ?? "More pages"}</span>
    </span>
  );
}
