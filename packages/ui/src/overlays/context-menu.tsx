"use client";

import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "./menu";

/**
 * Context menu anatomy activated by native right-click or touch long-press.
 * Root retains Base UI disabled, loop-focus, and open-change props; menu parts
 * expose native highlighted, checked, disabled, submenu, and positioning states
 * with the same semantic Public/Product and light/dark treatment as Menu. Base
 * UI owns activation coordinates, long-press, keyboard typeahead/arrow focus,
 * portal, Escape/outside dismissal, and selection. Provide a visible alternate
 * route to important actions; do not make context-menu discovery mandatory.
 */
export const ContextMenu = {
  Root: BaseContextMenu.Root,
  Trigger: BaseContextMenu.Trigger,
  Portal: BaseContextMenu.Portal,
  Backdrop: Menu.Backdrop,
  Positioner: Menu.Positioner,
  Viewport: Menu.Viewport,
  Popup: Menu.Popup,
  Arrow: Menu.Arrow,
  Group: Menu.Group,
  GroupLabel: Menu.GroupLabel,
  Item: Menu.Item,
  LinkItem: Menu.LinkItem,
  CheckboxItem: Menu.CheckboxItem,
  CheckboxItemIndicator: Menu.CheckboxItemIndicator,
  RadioGroup: Menu.RadioGroup,
  RadioItem: Menu.RadioItem,
  RadioItemIndicator: Menu.RadioItemIndicator,
  Separator: Menu.Separator,
  SubmenuRoot: Menu.SubmenuRoot,
  SubmenuTrigger: Menu.SubmenuTrigger,
} as const;
