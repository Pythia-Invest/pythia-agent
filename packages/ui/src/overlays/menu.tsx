"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";
import { mergeClassName } from "./class-names";

function MenuPositioner({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Positioner>) {
  return (
    <BaseMenu.Positioner
      className={mergeClassName("py-floating-positioner", className)}
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
      className={mergeClassName("py-floating-popup py-menu-popup", className)}
      {...props}
    />
  );
}

function MenuArrow({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Arrow>) {
  return (
    <BaseMenu.Arrow
      className={mergeClassName("py-floating-arrow", className)}
      {...props}
    />
  );
}

function MenuItem({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={mergeClassName("py-menu-item", className)}
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
      className={mergeClassName("py-menu-item", className)}
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
      className={mergeClassName("py-menu-item py-menu-choice-item", className)}
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
      className={mergeClassName("py-menu-item py-menu-choice-item", className)}
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
      className={mergeClassName("py-menu-indicator", className)}
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
      className={mergeClassName("py-menu-indicator", className)}
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
      className={mergeClassName("py-menu-group-label", className)}
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
      className={mergeClassName("py-menu-separator", className)}
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
      className={mergeClassName(
        "py-menu-item py-menu-submenu-trigger",
        className,
      )}
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
