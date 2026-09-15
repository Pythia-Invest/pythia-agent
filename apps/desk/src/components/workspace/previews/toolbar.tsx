import { Tooltip } from "@pythia/ui";
import type { ReactNode } from "react";

export function PreviewToolbar({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return (
    <Tooltip.Provider delay={300}>
      <fieldset
        data-slot="workspace-preview-toolbar"
        aria-label={label}
        className="sticky top-0 z-10 flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-border border-b bg-canvas px-3 py-1 text-xs"
      >
        {children}
      </fieldset>
    </Tooltip.Provider>
  );
}
