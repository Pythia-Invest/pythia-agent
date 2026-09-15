import type { ReactNode } from "react";
import { DeskProviders } from "@/client/providers";
import { WorkspaceInteractions } from "@/components/workspace/workspace-interactions";
import { DeskShell } from "@/components/shell/desk-shell";

/** Every routed Desk surface shares the sidebar shell and the query cache. */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <DeskProviders>
      <WorkspaceInteractions>
        <DeskShell>{children}</DeskShell>
      </WorkspaceInteractions>
    </DeskProviders>
  );
}
