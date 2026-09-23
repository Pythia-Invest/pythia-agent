"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { WidgetStyleScope } from "./scope";

const ToolbarContext = createContext<{
  target: HTMLDivElement | null;
  attach: (element: HTMLDivElement | null) => void;
} | null>(null);

/** Host-owned placement. Each reader gets its own outlet and lifetime. */
export function WidgetToolbarProvider({ children }: { children: ReactNode }) {
  const [target, attach] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ target, attach }), [target]);
  return <ToolbarContext value={value}>{children}</ToolbarContext>;
}

export function WidgetToolbarOutlet() {
  const context = useContext(ToolbarContext);
  return (
    <div
      ref={context?.attach}
      className="flex items-center gap-1 empty:hidden"
    />
  );
}

/** Render feature commands in the reader toolbar, or locally in standalone hosts. */
export function WidgetToolbar({ children }: { children: ReactNode }) {
  const context = useContext(ToolbarContext);
  const scope = useContext(WidgetStyleScope);
  const content = (
    <div
      data-pythia-widget={scope}
      data-slot="widget-toolbar"
      className="flex items-center gap-1"
    >
      {children}
    </div>
  );
  if (!context) return content;
  return context.target ? createPortal(content, context.target) : null;
}
