import type { ComponentProps } from "react";
import { cn } from "../class-name";
import { sidebarRow } from "./sidebar-row";

export type SidebarProps = ComponentProps<"aside">;

/**
 * Reusable semantic aside framing persistent or contextual navigation.
 *
 * Native aside props pass through; it owns no collapsed/open variant or route
 * state. Surface, spacing, Public/Product density, and light/dark treatment use
 * semantic/profile tokens. Label its descendant navigation for assistive
 * technology. Use as layout framing; do not put app workflows or responsive
 * state management in the shared package.
 */
export function Sidebar({ className, ...props }: SidebarProps) {
  return (
    <aside
      className={cn(
        "flex min-h-0 min-w-56 flex-col border-border border-r bg-container text-body text-foreground",
        className,
      )}
      data-slot="sidebar"
      {...props}
    />
  );
}

export type SidebarHeaderProps = ComponentProps<"header">;

/**
 * Header region for sidebar identity or high-level context.
 *
 * Native header props pass through; it has no interactive states or variants.
 * Border, spacing, and text inherit semantic profile/theme tokens. Keep actual
 * controls keyboard-accessible in their own components. Use for concise
 * framing; do not turn it into an application-specific company header.
 */
export function SidebarHeader({ className, ...props }: SidebarHeaderProps) {
  return (
    <header
      className={cn("border-border border-b p-3", className)}
      data-slot="sidebar-header"
      {...props}
    />
  );
}

export type SidebarContentProps = ComponentProps<"div">;

/**
 * Scrollable middle region containing sidebar navigation groups.
 *
 * Native div props pass through; it has no selection or responsive state.
 * Profile density and light/dark surfaces use shared tokens. Browser scrolling
 * remains native and links retain their own focus behavior. Use for reusable
 * navigation content; do not fetch or filter product data here.
 */
export function SidebarContent({ className, ...props }: SidebarContentProps) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto p-2", className)}
      data-slot="sidebar-content"
      {...props}
    />
  );
}

export type SidebarFooterProps = ComponentProps<"footer">;

/**
 * Footer region for secondary navigation or compact controls.
 *
 * Native footer props pass through with semantic border, spacing, profile, and
 * theme treatment. It owns no interactive state, and descendant controls keep
 * native accessibility/keyboard behavior. Use for secondary reusable actions;
 * do not put submission or account workflows in the component itself.
 */
export function SidebarFooter({ className, ...props }: SidebarFooterProps) {
  return (
    <footer
      className={cn("border-border border-t p-3", className)}
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

export type SidebarSectionProps = ComponentProps<"section">;

/**
 * Semantic grouping region within sidebar content.
 *
 * Native section props pass through; spacing follows profile aliases and it
 * has no active/theme-specific behavior. Name the section with a heading or
 * ARIA label so assistive technology can identify it. Use for related
 * destinations; do not make the section itself interactive or collapsible.
 */
export function SidebarSection({ className, ...props }: SidebarSectionProps) {
  return (
    <section
      className={cn("grid gap-1 py-2", className)}
      data-slot="sidebar-section"
      {...props}
    />
  );
}

export type SidebarSectionLabelProps = ComponentProps<"h2">;

/**
 * Low-emphasis heading naming a sidebar section.
 *
 * Native heading props pass through and semantic secondary text adapts across
 * profiles/themes. It is not focusable and has no selected state. Keep document
 * heading order meaningful when changing the rendered context; do not use it
 * as a clickable expander.
 */
export function SidebarSectionLabel({
  className,
  ...props
}: SidebarSectionLabelProps) {
  return (
    <h2
      className={cn(
        "m-0 p-2 font-semibold text-foreground-secondary text-xs",
        className,
      )}
      data-slot="sidebar-section-label"
      {...props}
    />
  );
}

export type SidebarNavProps = ComponentProps<"nav">;

/**
 * Labelled navigation landmark within a sidebar.
 *
 * Native nav props pass through; it has no route or selected-state owner and
 * inherits semantic profile/theme styling. Links retain browser focus and
 * keyboard activation. Supply a visible or ARIA label when multiple landmarks
 * exist; do not infer destinations from children.
 */
export function SidebarNav({ className, ...props }: SidebarNavProps) {
  return <nav className={cn(className)} data-slot="sidebar-nav" {...props} />;
}

export type SidebarListProps = ComponentProps<"ul">;

/**
 * Semantic list of sidebar navigation items.
 *
 * Native list props pass through; gap and density derive from profile aliases
 * while colors come from descendants. List structure remains available to
 * assistive technology. Use `SidebarItem` children; do not render a set of
 * unrelated ungrouped links.
 */
export function SidebarList({ className, ...props }: SidebarListProps) {
  return (
    <ul
      className={cn("m-0 grid list-none gap-1 p-0", className)}
      data-slot="sidebar-list"
      {...props}
    />
  );
}

export type SidebarItemProps = ComponentProps<"li">;

/**
 * Semantic wrapper for one sidebar destination.
 *
 * Native list-item props pass through; it owns no selection, profile, or theme
 * state. Focus remains on its descendant link. Use one destination or compact
 * labelled control per item; do not make the list item itself clickable.
 */
export function SidebarItem({ className, ...props }: SidebarItemProps) {
  return <li className={cn(className)} data-slot="sidebar-item" {...props} />;
}

export type SidebarButtonProps = ComponentProps<"button">;

/**
 * Sidebar row that performs an action instead of navigating.
 *
 * Native button props pass through and it shares the link row geometry, hover,
 * and focus treatment across Public/Product and light/dark. The browser keeps
 * native Enter/Space activation. Use it for commands that belong in the
 * navigation column, such as starting something new; do not use it for a real
 * destination that deserves a link.
 */
export function SidebarButton({
  className,
  type = "button",
  ...props
}: SidebarButtonProps) {
  return (
    <button
      className={cn(
        sidebarRow,
        "cursor-pointer border-0 bg-transparent",
        className,
      )}
      data-slot="sidebar-button"
      type={type}
      {...props}
    />
  );
}
