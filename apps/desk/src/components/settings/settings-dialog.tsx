"use client";

import { Dialog } from "@pythia/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { resolvePage } from "./sections";
import {
  closeSettings,
  openSettings,
  useSettingsAddress,
} from "./settings-address";
import { SettingsShell } from "./settings-shell";

/** Skills and tools moved to Capabilities; their old Settings links follow. */
const CAPABILITIES: Record<string, string> = {
  skills: "/capabilities?tab=skills",
  tools: "/capabilities?tab=tools",
};

/** The open Settings page, if any; for marking the navigation item. */
export function useOpenSettings() {
  const address = useSettingsAddress();
  return address === null ? null : (resolvePage(address)?.id ?? "");
}

export function SettingsDialog() {
  const router = useRouter();
  const address = useSettingsAddress();
  const moved = address === null ? undefined : CAPABILITIES[address];
  useEffect(() => {
    if (!moved) return;
    closeSettings();
    router.push(moved);
  }, [moved, router]);
  const open = address !== null && !moved;
  // The closing dialog keeps its last page while it animates out.
  const shown = useRef<string | null>(null);
  if (open) shown.current = address || null;
  // Focus lands on the dialog itself, not on search with its focus ring;
  // Tab reaches search first.
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSettings();
      }}
    >
      <Dialog.Portal>
        <Dialog.Viewport className="p-0">
          <Dialog.Popup
            ref={popup}
            initialFocus={popup}
            className="flex h-dvh max-h-none w-full overflow-hidden rounded-none border-0 p-0 shadow-none outline-none data-ending-style:scale-100 data-starting-style:scale-100"
            data-slot="settings-dialog"
          >
            <SettingsShell
              address={shown.current}
              onPage={(page) => openSettings(page ?? undefined)}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
