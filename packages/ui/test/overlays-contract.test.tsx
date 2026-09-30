import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { PreviewCard as BasePreviewCard } from "@base-ui/react/preview-card";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { describe, expect, it } from "vitest";
import { ContextMenu } from "../src/overlays/context-menu";
import { AlertDialog, Dialog } from "../src/overlays/dialog";
import { Drawer } from "../src/overlays/drawer";
import { Menu } from "../src/overlays/menu";
import { PreviewCard } from "../src/overlays/preview-card";
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
});
