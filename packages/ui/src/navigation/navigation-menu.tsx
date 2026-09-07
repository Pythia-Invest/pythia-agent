"use client";

import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu";
import { ChevronDown } from "lucide-react";
import { cnState } from "../class-name";

export type NavigationMenuProps<Value = unknown> =
  NavigationMenuPrimitive.Root.Props<Value>;

/**
 * Base UI navigation-menu state owner for grouped destination links.
 *
 * Generic controlled/uncontrolled value, orientation, and open/close delay
 * props remain native. Root and parts use semantic Public/Product and
 * light/dark tokens, with open/active treatment neutral. Base UI owns hover,
 * focus, arrow keys, dismissal, and nested-menu behavior. Supply destinations
 * from the app; do not use it for workflow commands or product data.
 */
export function NavigationMenu<Value>({
  className,
  ...props
}: NavigationMenuProps<Value>) {
  return (
    <NavigationMenuPrimitive.Root
      className={cnState(
        "group/navigation-menu relative text-body text-foreground",
        className,
      )}
      data-slot="navigation-menu"
      {...props}
    />
  );
}

export type NavigationMenuListProps = NavigationMenuPrimitive.List.Props;

/**
 * Native list of top-level navigation-menu items.
 *
 * Base UI list/render/state props pass through. Orientation, density, and
 * light/dark appearance derive from semantic/profile tokens. Base UI preserves
 * list semantics and composite keyboard navigation. Use native menu items as
 * children; do not create a parallel roving-focus list.
 */
export function NavigationMenuList({
  className,
  ...props
}: NavigationMenuListProps) {
  return (
    <NavigationMenuPrimitive.List
      className={cnState(
        "m-0 flex list-none items-center gap-1 p-0 group-data-[orientation=vertical]/navigation-menu:flex-col group-data-[orientation=vertical]/navigation-menu:items-stretch",
        className,
      )}
      data-slot="navigation-menu-list"
      {...props}
    />
  );
}

export type NavigationMenuItemProps = NavigationMenuPrimitive.Item.Props;

/**
 * One value-bearing item inside `NavigationMenuList`.
 *
 * Native value, render, and DOM props pass to Base UI. It has no Pythia-owned
 * active state or theme fork; descendant parts provide presentation. Base UI
 * owns item registration and focus relationships. Compose a trigger/content or
 * direct link; do not attach route-selection state to the list item.
 */
export function NavigationMenuItem({
  className,
  ...props
}: NavigationMenuItemProps) {
  return (
    <NavigationMenuPrimitive.Item
      className={cnState("", className)}
      data-slot="navigation-menu-item"
      {...props}
    />
  );
}

/** Row treatment shared by triggers and links. */
const navigationRow =
  "inline-flex min-h-control items-center gap-1 rounded-control border-0 bg-transparent px-3 py-1 text-foreground no-underline transition-colors motion-fast hover:bg-interaction-hover";

export type NavigationMenuTriggerProps = NavigationMenuPrimitive.Trigger.Props;

/**
 * Button revealing the associated navigation-menu content.
 *
 * Native button/render and open-state props pass through; an optional child
 * label is followed by the native open-state icon. Neutral interaction tokens
 * handle Public/Product and light/dark. Base UI owns hover/click opening,
 * focus, and keyboard behavior. Use only when an item has a popup; do not add
 * custom timers or open state around it.
 */
export function NavigationMenuTrigger({
  children,
  className,
  ...props
}: NavigationMenuTriggerProps) {
  return (
    <NavigationMenuPrimitive.Trigger
      className={cnState(
        `${navigationRow} data-popup-open:bg-interaction-active`,
        className,
      )}
      data-slot="navigation-menu-trigger"
      {...props}
    >
      {children}
      <NavigationMenuPrimitive.Icon
        className="motion-standard inline-flex items-center text-foreground-secondary transition-transform data-popup-open:rotate-180 [&>svg]:size-3.5"
        data-slot="navigation-menu-icon"
      >
        <ChevronDown aria-hidden="true" />
      </NavigationMenuPrimitive.Icon>
    </NavigationMenuPrimitive.Trigger>
  );
}

export type NavigationMenuContentProps = NavigationMenuPrimitive.Content.Props;

/**
 * Item content moved by Base UI into the active menu popup.
 *
 * Native keep-mounted, transition, render, and DOM props pass through. Content
 * inherits semantic overlay colors and profile density without component
 * forks. Base UI owns activation direction and content mounting. Keep reusable
 * destination links inside; do not manually move or conditionally portal it.
 */
export function NavigationMenuContent({
  className,
  ...props
}: NavigationMenuContentProps) {
  return (
    <NavigationMenuPrimitive.Content
      className={cnState("p-3", className)}
      data-slot="navigation-menu-content"
      {...props}
    />
  );
}

/**
 * Native Base UI portal boundary for a navigation-menu popup.
 *
 * Container and keep-mounted props remain Base UI's API; it has no profile,
 * theme, active, or focus translation. Base UI owns mounting and teardown. Wrap
 * the native positioner with it; do not add another portal manager.
 */
export const NavigationMenuPortal = NavigationMenuPrimitive.Portal;

export type NavigationMenuPositionerProps =
  NavigationMenuPrimitive.Positioner.Props;

/**
 * Anchors the navigation-menu popup to its active trigger.
 *
 * Side, alignment, collision, offset, and state-aware props pass directly to
 * Base UI, with start alignment as the conventional default. It is visually
 * neutral across profiles/themes. Base UI owns placement and viewport collision
 * behavior. Use inside the native portal; do not calculate menu coordinates in
 * consuming code.
 */
export function NavigationMenuPositioner({
  align = "start",
  className,
  sideOffset = 8,
  ...props
}: NavigationMenuPositionerProps) {
  return (
    <NavigationMenuPrimitive.Positioner
      className={cnState("z-50", className)}
      align={align}
      data-slot="navigation-menu-positioner"
      sideOffset={sideOffset}
      {...props}
    />
  );
}

export type NavigationMenuPopupProps = NavigationMenuPrimitive.Popup.Props;

/**
 * Native navigation landmark containing the active menu viewport.
 *
 * Base UI render, transition, side, alignment, and open-state props pass
 * through. Semantic overlay and border tokens support both profiles/themes.
 * Base UI owns focus movement, Escape/outside dismissal, and content switching.
 * Use with `NavigationMenuViewport`; do not add a custom focus trap.
 */
export function NavigationMenuPopup({
  className,
  ...props
}: NavigationMenuPopupProps) {
  return (
    <NavigationMenuPrimitive.Popup
      className={cnState(
        "overflow-hidden rounded-container border border-border bg-overlay text-foreground shadow-popup",
        className,
      )}
      data-slot="navigation-menu-popup"
      {...props}
    />
  );
}

export type NavigationMenuViewportProps =
  NavigationMenuPrimitive.Viewport.Props;

/**
 * Clipping viewport for the active navigation-menu content.
 *
 * Native render and DOM props pass through; size and motion use profile and
 * semantic tokens in light/dark. Base UI owns content measurement and switching
 * behavior. Place it once inside the popup; do not animate content dimensions
 * from application state.
 */
export function NavigationMenuViewport({
  className,
  ...props
}: NavigationMenuViewportProps) {
  return (
    <NavigationMenuPrimitive.Viewport
      className={cnState(
        "motion-standard h-(--popup-height) min-h-12 w-(--popup-width) min-w-48 transition-[height,width]",
        className,
      )}
      data-slot="navigation-menu-viewport"
      {...props}
    />
  );
}

export type NavigationMenuLinkProps = NavigationMenuPrimitive.Link.Props;

/**
 * Native destination link inside or alongside a navigation menu.
 *
 * Anchor/render props, app-owned `href`, active state, and close-on-click pass
 * to Base UI. Active and hover states use neutral semantic tokens across
 * Public/Product and light/dark. Base UI owns link-press dismissal and
 * accessibility. Mark the real current destination; do not authorize URLs or
 * store routing state in this component.
 */
export function NavigationMenuLink({
  className,
  ...props
}: NavigationMenuLinkProps) {
  return (
    <NavigationMenuPrimitive.Link
      className={cnState(
        `${navigationRow} data-active:bg-interaction-active data-active:font-semibold`,
        className,
      )}
      data-slot="navigation-menu-link"
      {...props}
    />
  );
}
