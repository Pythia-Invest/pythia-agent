"use client";

import {
  Drawer,
  ResizableGroup,
  ResizablePanel,
  ResizableSeparator,
} from "@pythia/ui";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { useRestoredPanel } from "@/layout/use-restored-panel";
import { ArtifactNavigationContext } from "@/components/workspace/artifact-navigation";
import { AgentDockRail } from "./agent-dock";
import { DOCK_MAX, DOCK_MIN, writeDockWidth } from "./shell-layout";

function subscribeWidth(listener: () => void) {
  const media = window.matchMedia("(min-width: 900px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
export function useWideShell() {
  return useSyncExternalStore(
    subscribeWidth,
    () => window.matchMedia("(min-width: 900px)").matches,
    () => false,
  );
}

/** The desktop dock stays beside the destination; phones open it explicitly
 * as a temporary sheet so the destination retains the entire reading width. */
export function ShellDock({
  children,
  dock,
  open,
  onOpenChange,
  width,
  ready,
}: {
  children: ReactNode;
  dock: (onHide: () => void) => ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: number;
  ready: boolean;
}) {
  const wide = useWideShell();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { panelRef, restored } = useRestoredPanel(width, ready && wide && open);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  return (
    <>
      <ResizableGroup
        data-slot="shell-dock-layout"
        data-restored={restored || undefined}
        disabled={!ready || !wide || !open}
        className="[[data-desk-dock-open=false]_&>[data-layout-panel=dock]]:hidden! max-[899px]:[&>[data-layout-panel=dock]]:hidden! min-w-0 flex-1 rounded-none border-0 [&:not([data-restored])>[data-layout-panel=dock]]:shrink-0! [&:not([data-restored])>[data-layout-panel=dock]]:grow-0! [&:not([data-restored])>[data-layout-panel=dock]]:basis-[min(var(--desk-dock-width,420px),calc(100%_-_4px))]! [&:not([data-restored])>[data-layout-panel=main]]:flex-1! max-[899px]:[&>[data-layout-panel=main]]:flex-1! [[data-desk-dock-open=false]_&>[data-layout-panel=main]]:flex-1!"
        onLayoutChanged={(_, meta) => {
          if (
            meta.isUserInteraction &&
            ready &&
            wide &&
            open &&
            panelRef.current
          )
            writeDockWidth(panelRef.current.getSize().inPixels);
        }}
      >
        <ResizablePanel
          data-layout-panel="main"
          className="flex flex-col bg-raised"
        >
          {children}
        </ResizablePanel>
        <ResizableSeparator
          aria-label="Resize Pythia"
          className="group hidden cursor-col-resize bg-transparent hover:bg-transparent aria-[orientation=vertical]:w-1 data-[separator=active]:bg-transparent min-[900px]:grid [[data-desk-dock-open=false]_&]:hidden"
        >
          <span
            aria-hidden="true"
            className="motion-fast h-full w-px bg-border transition-colors group-hover:bg-border-strong group-data-[separator=active]:bg-border-strong"
          />
        </ResizableSeparator>
        <ResizablePanel
          data-layout-panel="dock"
          panelRef={panelRef}
          className="flex flex-col"
          defaultSize={420}
          minSize={DOCK_MIN}
          maxSize={DOCK_MAX}
          groupResizeBehavior="preserve-pixel-size"
        >
          {ready && wide && open ? dock(() => onOpenChange(false)) : null}
        </ResizablePanel>
      </ResizableGroup>
      <AgentDockRail
        className="min-[900px]:[[data-desk-dock-open=true]_&]:hidden"
        onOpen={() => (wide ? onOpenChange(true) : setMobileOpen(true))}
      />
      <Drawer.Root
        open={!wide && mobileOpen}
        onOpenChange={setMobileOpen}
        swipeDirection="left"
      >
        <Drawer.Portal>
          <Drawer.Backdrop />
          <Drawer.Viewport>
            <Drawer.Popup aria-label="Pythia chat" className="border-0">
              <Drawer.Content className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                <ArtifactNavigationContext.Provider
                  value={() => setMobileOpen(false)}
                >
                  {!wide && mobileOpen
                    ? dock(() => setMobileOpen(false))
                    : null}
                </ArtifactNavigationContext.Provider>
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}
