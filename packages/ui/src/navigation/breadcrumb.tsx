import { MoreHorizontal, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { joinClassNames } from "./class-name";

export type BreadcrumbProps = ComponentProps<"nav">;

/**
 * Landmark showing the current page's place in an application hierarchy.
 *
 * Native nav props pass through; it has no variants or selected state and uses
 * semantic text across Public/Product and light/dark. The default accessible
 * label is “Breadcrumb,” and links retain native keyboard behavior. Use for a
 * real hierarchy supplied by the app; do not generate routes or data here.
 */
export function Breadcrumb({
  "aria-label": ariaLabel = "Breadcrumb",
  className,
  ...props
}: BreadcrumbProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={joinClassNames("pythia-breadcrumb", className)}
      {...props}
    />
  );
}

export type BreadcrumbListProps = ComponentProps<"ol">;

/**
 * Ordered list of breadcrumb items.
 *
 * Native list props pass through; wrapping and spacing follow profile aliases
 * and semantic light/dark text. The ordered-list structure conveys sequence to
 * assistive technology. Use `BreadcrumbItem` children; do not flatten the
 * hierarchy into visually separated spans.
 */
export function BreadcrumbList({ className, ...props }: BreadcrumbListProps) {
  return (
    <ol
      className={joinClassNames("pythia-breadcrumb__list", className)}
      {...props}
    />
  );
}

export type BreadcrumbItemProps = ComponentProps<"li">;

/**
 * One semantic item in a breadcrumb sequence.
 *
 * Native list-item props pass through; it inherits profile/theme spacing and
 * has no active behavior. List semantics remain available to assistive
 * technology. Compose a link or current page plus separators between items;
 * do not make the list item itself interactive.
 */
export function BreadcrumbItem({ className, ...props }: BreadcrumbItemProps) {
  return (
    <li
      className={joinClassNames("pythia-breadcrumb__item", className)}
      {...props}
    />
  );
}

export type BreadcrumbLinkProps = ComponentProps<"a">;

/**
 * Native link to an ancestor represented by a breadcrumb item.
 *
 * All anchor props, including app-owned `href`, pass through. Hover/focus use
 * neutral semantic tokens across profiles/themes; browser link semantics and
 * keyboard activation remain native. Use only for navigable ancestors; do not
 * use it for the current page or authorize URLs in the UI package.
 */
export function BreadcrumbLink({ className, ...props }: BreadcrumbLinkProps) {
  return (
    <a
      className={joinClassNames("pythia-breadcrumb__link", className)}
      {...props}
    />
  );
}

export type BreadcrumbPageProps = ComponentProps<"span">;

/**
 * Non-link text naming the current breadcrumb page.
 *
 * Native span props pass through and `aria-current="page"` is fixed by the
 * component. Primary semantic text adapts to both profiles/themes. It is not a
 * keyboard stop. Use once at the end of the sequence; do not make it a link.
 */
export function BreadcrumbPage({ className, ...props }: BreadcrumbPageProps) {
  return (
    <span
      className={joinClassNames("pythia-breadcrumb__page", className)}
      {...props}
      aria-current="page"
    />
  );
}

export type BreadcrumbSeparatorProps = ComponentProps<"li">;

/**
 * Decorative divider between breadcrumb items.
 *
 * Native list-item props and optional children pass through; the default icon
 * follows semantic secondary text in every profile/theme. It is hidden from
 * assistive technology and never focusable. Place only between items; do not
 * use it to communicate hierarchy without the ordered list.
 */
export function BreadcrumbSeparator({
  children,
  className,
  ...props
}: BreadcrumbSeparatorProps) {
  return (
    <li
      className={joinClassNames("pythia-breadcrumb__separator", className)}
      {...props}
      aria-hidden="true"
    >
      {children ?? <ChevronRight />}
    </li>
  );
}

export type BreadcrumbEllipsisProps = ComponentProps<"span">;

/**
 * Accessible compact marker for omitted breadcrumb ancestors.
 *
 * Native span props pass through and the hidden label may be overridden via
 * children. Secondary semantic treatment works in both profiles/themes; the
 * marker is non-interactive and skipped by keyboard navigation. Use only when
 * ancestors are genuinely omitted; do not hide the current page.
 */
export function BreadcrumbEllipsis({
  children,
  className,
  ...props
}: BreadcrumbEllipsisProps) {
  return (
    <span
      className={joinClassNames("pythia-breadcrumb__ellipsis", className)}
      {...props}
    >
      <MoreHorizontal aria-hidden="true" />
      <span className="pythia-visually-hidden">{children ?? "More pages"}</span>
    </span>
  );
}
