"use client";

import type { ResizablePanelProps } from "@pythia/ui";
import { type Ref, useLayoutEffect, useRef, useState } from "react";

type PanelHandle =
  NonNullable<ResizablePanelProps["panelRef"]> extends Ref<infer T> ? T : never;

/** Hand prepaint CSS geometry to the native resizer before releasing the CSS
 * override. Never change defaultSize during a drag: that re-registers the panel. */
export function useRestoredPanel(size: number, enabled: boolean) {
  const panelRef = useRef<PanelHandle | null>(null);
  const [restored, setRestored] = useState(false);
  useLayoutEffect(() => {
    if (!enabled || !panelRef.current) return;
    panelRef.current.resize(size);
    setRestored(true);
  }, [size, enabled]);
  return { panelRef, restored };
}
