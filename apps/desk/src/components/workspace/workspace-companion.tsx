"use client";

import {
  Drawer,
  Tabs,
  TabPanel,
  ResizableGroup,
  ResizablePanel,
  ResizableSeparator,
} from "@pythia/ui";
import { ChatTabs } from "@/components/shell/chat-tabs";
import type { ReactNode } from "react";
import { useWideShell } from "@/components/shell/shell-dock";
import { useWorkspaceReader } from "./reader-context";
import { WorkspaceFileIcon } from "./workspace-file-icon";
import { WorkspaceReader } from "./workspace-reader";

export function WorkspaceCompanion({ children }: { children: ReactNode }) {
  const reader = useWorkspaceReader();
  const wide = useWideShell();
  const panel = reader?.artifact ? (
    <div
      data-slot="workspace-companion"
      className="flex min-h-0 flex-1 flex-col bg-raised"
    >
      <Tabs
        value={`file:${reader.artifact.path}`}
        onValueChange={(value) => {
          const file = reader.files.find(
            (file) => `file:${file.path}` === value,
          );
          if (file) reader.open(file);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex h-10 shrink-0 items-stretch border-border border-b bg-canvas">
          <ChatTabs
            kind="file"
            activeId={reader.artifact.path}
            onClose={reader.closeFile}
            onSelect={(path) => {
              const file = reader.files.find((file) => file.path === path);
              if (file) reader.open(file);
            }}
            tabs={reader.files.map((file) => ({
              id: file.path,
              description: file.path,
              icon: (
                <WorkspaceFileIcon
                  entry={{ name: file.path }}
                  className="size-3.5"
                />
              ),
              title: file.path.split("/").at(-1) || "Workspace",
            }))}
          />
        </header>
        <TabPanel
          key={reader.artifact.path}
          value={`file:${reader.artifact.path}`}
          className="flex min-h-0 flex-1 flex-col py-0"
        >
          <WorkspaceReader
            {...reader.artifact}
            onOpen={reader.open}
            placement="companion"
          />
        </TabPanel>
      </Tabs>
    </div>
  ) : null;
  if (!wide)
    return (
      <>
        {children}
        {panel ? (
          <Drawer.Root
            open
            onOpenChange={(open) => {
              if (!open) reader?.close();
            }}
            swipeDirection="left"
          >
            <Drawer.Portal>
              <Drawer.Backdrop />
              <Drawer.Viewport>
                <Drawer.Popup
                  aria-label="Workspace artifact"
                  className="border-0"
                >
                  <Drawer.Content className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
                    {panel}
                  </Drawer.Content>
                </Drawer.Popup>
              </Drawer.Viewport>
            </Drawer.Portal>
          </Drawer.Root>
        ) : null}
      </>
    );
  return (
    <ResizableGroup
      data-slot="workspace-companion-layout"
      className="min-w-0 flex-1 rounded-none border-0"
    >
      <ResizablePanel className="flex min-w-0 flex-col">
        {children}
      </ResizablePanel>
      {panel ? (
        <>
          <ResizableSeparator aria-label="Resize workspace viewer" />
          <ResizablePanel
            defaultSize="45%"
            minSize="25%"
            maxSize="70%"
            className="flex min-w-0 flex-col"
          >
            {panel}
          </ResizablePanel>
        </>
      ) : null}
    </ResizableGroup>
  );
}
