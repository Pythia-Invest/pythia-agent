import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextMenu } from "../src/overlays/context-menu";
import { AlertDialog, Dialog } from "../src/overlays/dialog";
import { Drawer, Sheet } from "../src/overlays/drawer";
import { DropdownMenu, Menu } from "../src/overlays/menu";
import { HoverCard, PreviewCard } from "../src/overlays/preview-card";
import { Popover } from "../src/overlays/popover";
import { Tooltip } from "../src/overlays/tooltip";

describe("overlay native contracts", () => {
  it("retains Base UI root, trigger, and portal owners", () => {
    expect(Dialog.Root).toBe(BaseDialog.Root);
    expect(Dialog.Trigger).toBe(BaseDialog.Trigger);
    expect(Dialog.Portal).toBe(BaseDialog.Portal);
    expect(AlertDialog.Root).toBe(BaseAlertDialog.Root);
    expect(Drawer.Root).toBe(BaseDrawer.Root);
    expect(Drawer.Portal).toBe(BaseDrawer.Portal);
    expect(Popover.Root).toBe(BasePopover.Root);
    expect(Popover.Portal).toBe(BasePopover.Portal);
    expect(Tooltip.Root).toBe(BaseTooltip.Root);
    expect(Tooltip.Provider).toBe(BaseTooltip.Provider);
    expect(PreviewCard.Root).toBe(BasePreviewCard.Root);
    expect(Menu.Root).toBe(BaseMenu.Root);
    expect(Menu.Portal).toBe(BaseMenu.Portal);
    expect(ContextMenu.Root).toBe(BaseContextMenu.Root);
  });

  it("keeps vocabulary aliases on the same implementation", () => {
    expect(Sheet).toBe(Drawer);
    expect(HoverCard).toBe(PreviewCard);
    expect(DropdownMenu).toBe(Menu);
  });

  it("renders native dialog and menu trigger semantics", () => {
    const dialog = renderToStaticMarkup(
      <Dialog.Root>
        <Dialog.Trigger>Open dialog</Dialog.Trigger>
      </Dialog.Root>,
    );
    const menu = renderToStaticMarkup(
      <Menu.Root>
        <Menu.Trigger>Open menu</Menu.Trigger>
      </Menu.Root>,
    );

    expect(dialog).toContain('aria-haspopup="dialog"');
    expect(dialog).toContain('aria-expanded="false"');
    expect(menu).toContain('aria-haspopup="menu"');
  });

  it("exposes complete specialist anatomy without a custom portal or focus owner", () => {
    expect(Object.keys(Dialog)).toEqual([
      "Root",
      "Trigger",
      "Portal",
      "Backdrop",
      "Viewport",
      "Popup",
      "Title",
      "Description",
      "Close",
    ]);
    expect(Object.keys(Drawer)).toContain("SwipeArea");
    expect(Object.keys(Menu)).toEqual(
      expect.arrayContaining([
        "CheckboxItem",
        "RadioItem",
        "SubmenuRoot",
        "SubmenuTrigger",
      ]),
    );
    expect(Object.keys(ContextMenu)).toContain("Trigger");
  });
});
