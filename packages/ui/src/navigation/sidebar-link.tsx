"use client";

import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps } from "react";
import { cn } from "../class-name";
import { sidebarRow } from "./sidebar-row";

export interface SidebarLinkProps extends ComponentProps<"a"> {
  /** Marks the app-owned destination as active with neutral navigation styling. */
  active?: boolean;
  /**
   * Replaces the native anchor with the application's link component, for
   * example Next's `Link`, while keeping the sidebar row treatment and state.
   */
  render?: useRender.RenderProp;
}

/**
 * Sidebar destination link with optional active-page semantics.
 *
 * Anchor props and app-owned `href` pass through; `active` adds
 * `aria-current="page"` and neutral selection styling, and `render` lets a
 * router-aware link own navigation. Public/Product density and light/dark
 * colors use semantic tokens. Browser focus and activation stay native. Mark
 * only the real current route; do not store routing state here.
 */
export function SidebarLink({
  "aria-current": ariaCurrent,
  active = false,
  className,
  ref,
  render,
  ...props
}: SidebarLinkProps) {
  return useRender({
    defaultTagName: "a",
    props: {
      ...props,
      "aria-current": active ? "page" : ariaCurrent,
      className: cn(sidebarRow, className),
      "data-active": active ? "" : undefined,
      "data-slot": "sidebar-link",
    },
    ref,
    render,
  });
}
