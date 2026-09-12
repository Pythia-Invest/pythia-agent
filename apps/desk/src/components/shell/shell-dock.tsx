"use client";

import {
  Drawer,
  ResizableGroup,
  ResizablePanel,
  ResizableSeparator,
} from "@pythia/ui";
import {
  type ReactNode,
  type RefObject,
  useState,
  useSyncExternalStore,
} from "react";
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
}: {
  children: ReactNode;
  dock: (onHide: () => void) => ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: RefObject<number>;
}) {
  const wide = useWideShell();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!wide)
    return (
      <>
        {children}
        <AgentDockRail onOpen={() => setMobileOpen(true)} />
        <Drawer.Root
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          swipeDirection="left"
        >
          <Drawer.Portal>
            <Drawer.Backdrop />
            <Drawer.Viewport>
              <Drawer.Popup aria-label="Pythia chat" className="border-0">
                <Drawer.Content className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                  {dock(() => setMobileOpen(false))}
                </Drawer.Content>
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.Root>
      </>
    );
  if (!open)
    return (
      <>
        {children}
        <AgentDockRail onOpen={() => onOpenChange(true)} />
      </>
    );
  return (
    <ResizableGroup className="min-w-0 flex-1 rounded-none border-0">
      <ResizablePanel className="flex flex-col bg-raised">
        {children}
      </ResizablePanel>
      <ResizableSeparator
        aria-label="Resize Pythia"
        className="group cursor-col-resize bg-transparent hover:bg-transparent aria-[orientation=vertical]:w-1 data-[separator=active]:bg-transparent"
      >
        <span
          aria-hidden="true"
          className="motion-fast h-full w-px bg-border transition-colors group-hover:bg-border-strong group-data-[separator=active]:bg-border-strong"
        />
      </ResizableSeparator>
      <ResizablePanel
        className="flex flex-col"
        defaultSize={width.current}
        maxSize={DOCK_MAX}
        minSize={DOCK_MIN}
        onResize={(size) => {
          width.current = size.inPixels;
          writeDockWidth(size.inPixels);
        }}
      >
        {dock(() => onOpenChange(false))}
      </ResizablePanel>
    </ResizableGroup>
  );
}
