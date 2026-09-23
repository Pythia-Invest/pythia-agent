"use client";

import { WidgetToolbarProvider } from "@pythia/widget-sdk";
import type { ReactNode } from "react";

export function WorkspaceReaderFrame({ children }: { children: ReactNode }) {
  return (
    <WidgetToolbarProvider>
      <section
        data-slot="workspace-reader"
        className="@container flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {children}
      </section>
    </WidgetToolbarProvider>
  );
}
