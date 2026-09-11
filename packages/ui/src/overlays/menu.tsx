"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { OverlayArrowShape, overlayArrowClasses } from "./arrow";
import { overlayClasses } from "./shared";

const menuItem =
  "relative flex min-h-control cursor-default select-none items-center gap-2 rounded-control px-3 py-2 text-body leading-ui text-foreground outline-0 data-highlighted:bg-interaction-hover data-disabled:pointer-events-none data-disabled:opacity-disabled";
const menuChoiceItem = `${menuItem} ps-8`;
const menuIndicator =
  "absolute start-3 grid w-4 place-items-center [&>svg]:size-3.5";

function MenuPositioner({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Positioner>) {
  return (
    <BaseMenu.Positioner
      className={cnState(overlayClasses.positioner, className)}
      data-slot="menu-positioner"
      sideOffset={6}
      {...props}
    />
  );
}

function MenuPopup({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Popup>) {
  return (
    <BaseMenu.Popup
      className={cnState(
        `${overlayClasses.surface} ${overlayClasses.floating} min-w-48 p-1`,
        className,
      )}
      data-slot="menu-popup"
      {...props}
    />
  );
}

function MenuArrow({
  children,
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Arrow>) {
  return (
    <BaseMenu.Arrow
      className={cnState(
        `${overlayArrowClasses} ${overlayClasses.arrow}`,
        className,
      )}
      data-slot="menu-arrow"
      {...props}
    >
      {children ?? <OverlayArrowShape />}
    </BaseMenu.Arrow>
  );
}

function MenuItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cnState(menuItem, className)}
      data-slot="menu-item"
      {...props}
    />
  );
}

function MenuLinkItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.LinkItem>) {
  return (
    <BaseMenu.LinkItem
      className={cnState(`${menuItem} no-underline`, className)}
      data-slot="menu-link-item"
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem
      className={cnState(menuChoiceItem, className)}
      data-slot="menu-checkbox-item"
      {...props}
    />
  );
}

function MenuRadioItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem
      className={cnState(menuChoiceItem, className)}
      data-slot="menu-radio-item"
      {...props}
    />
  );
}

function MenuIndicator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.CheckboxItemIndicator>) {
  return (
    <BaseMenu.CheckboxItemIndicator
      className={cnState(menuIndicator, className)}
      data-slot="menu-indicator"
      {...props}
    />
  );
}

function MenuRadioIndicator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.RadioItemIndicator>) {
  return (
    <BaseMenu.RadioItemIndicator
      className={cnState(menuIndicator, className)}
      data-slot="menu-indicator"
      {...props}
    />
  );
}

function MenuGroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.GroupLabel>) {
  return (
    <BaseMenu.GroupLabel
      className={cnState(
        "px-3 pt-2 pb-1 font-semibold text-foreground-secondary text-xs",
        className,
      )}
      data-slot="menu-group-label"
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Separator>) {
  return (
    <BaseMenu.Separator
      className={cnState("mx-2 my-1 h-px bg-border", className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

function MenuSubmenuTrigger({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.SubmenuTrigger>) {
  return (
    <BaseMenu.SubmenuTrigger
      className={cnState(
        `${menuItem} after:ms-auto after:content-['›']`,
        className,
      )}
      data-slot="menu-submenu-trigger"
      {...props}
    />
  );
}

/**
 * Dropdown menu anatomy for compact action, link, checkbox, radio, and submenu
 * collections. Base UI parts retain controlled open, modal, orientation,
 * disabled, checked, loop-focus, positioning, and close behavior; their native
 * highlighted/checked/open states use semantic interaction styling across both
 * profiles and themes. Base UI owns keyboard arrow/typeahead focus, selection,
 * Escape/outside dismissal, portal, and focus restoration. Use for commands or
 * choices; do not model app workflow or duplicate native selection state.
 */
export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Portal: BaseMenu.Portal,
  Backdrop: BaseMenu.Backdrop,
  Positioner: MenuPositioner,
  Viewport: BaseMenu.Viewport,
  Popup: MenuPopup,
  Arrow: MenuArrow,
  Group: BaseMenu.Group,
  GroupLabel: MenuGroupLabel,
  Item: MenuItem,
  LinkItem: MenuLinkItem,
  CheckboxItem: MenuCheckboxItem,
  CheckboxItemIndicator: MenuIndicator,
  RadioGroup: BaseMenu.RadioGroup,
  RadioItem: MenuRadioItem,
  RadioItemIndicator: MenuRadioIndicator,
  Separator: MenuSeparator,
  SubmenuRoot: BaseMenu.SubmenuRoot,
  SubmenuTrigger: MenuSubmenuTrigger,
} as const;

/**
 * Explicit DropdownMenu alias for the shared Base UI Menu anatomy. It retains
 * Menu's open, modal, checked, disabled, highlighted, and positioning props,
 * native keyboard/typeahead/focus/dismissal paths, and semantic styling for all
 * profiles and themes. Use the alias when it clarifies that a trigger reveals
 * the menu; do not create separate dropdown behavior or product state behind it.
 */
export const DropdownMenu = Menu;
