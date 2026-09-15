"use client";

import { ResizableGroup, ResizablePanel, ResizableSeparator } from "@pythia/ui";
import { type ReactNode, useState } from "react";

/** Mounted only on desktop; keep the native panel's default stable while dragging. */
export function WorkspaceSplit({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [initialWidth] = useState(() => {
    try {
      const width = Number(
        localStorage.getItem("pythia.workspace.sidebar-width"),
      );
      if (width >= 160 && width <= 480) return width;
    } catch {
      /* Use the standard initial width. */
    }
    return 240;
  });
  return (
    <ResizableGroup className="flex-1 rounded-none border-0">
      <ResizablePanel
        defaultSize={initialWidth}
        minSize={160}
        maxSize="45%"
        onResize={(size) => {
          try {
            localStorage.setItem(
              "pythia.workspace.sidebar-width",
              String(size.inPixels),
            );
          } catch {
            /* Resizing remains available without storage. */
          }
        }}
      >
        {sidebar}
      </ResizablePanel>
      <ResizableSeparator
        aria-label="Resize folders"
        className="w-1 cursor-col-resize bg-transparent hover:bg-transparent"
      >
        <span
          aria-hidden="true"
          className="h-full w-px bg-border group-hover:bg-border-strong"
        />
      </ResizableSeparator>
      <ResizablePanel minSize={180} className="flex flex-col">
        {children}
      </ResizablePanel>
    </ResizableGroup>
  );
}
