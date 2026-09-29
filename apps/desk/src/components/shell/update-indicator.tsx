"use client";

import { cn, Dialog, PythiaLockup, SidebarLink } from "@pythia/ui";
import { CloudDownload, LoaderCircle, RotateCw } from "lucide-react";
import { useState } from "react";
import { useUpdateFlow } from "@/client/update-flow";
import { UpdateStatus, versionLabel } from "@/components/updates/update-status";

/**
 * The sidebar's quiet update mark, as Hermes Desktop's status-bar version
 * item: nothing while Pythia is current, and a single entry when an update
 * is ready, installing or waiting for a reload. It opens the update dialog;
 * the version itself lives in Settings.
 */
export function UpdateIndicator({ compactible }: { compactible?: boolean }) {
  const flow = useUpdateFlow();
  const [open, setOpen] = useState(false);
  const { phase } = flow;
  const shown =
    phase === "available" ||
    phase === "running" ||
    phase === "starting" ||
    phase === "complete" ||
    phase === "failed";
  if (!shown && !open) return null;
  const label =
    phase === "complete"
      ? "Reload to finish update"
      : phase === "running" || phase === "starting"
        ? "Updating Pythia…"
        : phase === "failed"
          ? "Update needs attention"
          : "Update available";
  const Icon =
    phase === "complete"
      ? RotateCw
      : phase === "running" || phase === "starting"
        ? LoaderCircle
        : CloudDownload;
  return (
    <>
      {shown ? (
        <SidebarLink
          render={<button type="button" />}
          onClick={() => setOpen(true)}
          title={label}
          aria-label={label}
          data-slot="update-indicator"
          className={cn(
            "gap-2.5 text-body",
            phase === "failed" ? "text-warning" : "text-info",
            compactible &&
              "[[data-desk-rail-collapsed=true]_&]:justify-center [[data-desk-rail-collapsed=true]_&]:px-0",
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "size-[18px] flex-none stroke-[1.6]",
              Icon === LoaderCircle && "motion-safe:animate-spin",
            )}
          />
          <span
            className={cn(
              "min-w-0 truncate",
              compactible && "[[data-desk-rail-collapsed=true]_&]:sr-only",
            )}
          >
            {label}
          </span>
        </SidebarLink>
      ) : null}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop forceRender />
          <Dialog.Viewport>
            <Dialog.Popup
              className="grid w-[min(26rem,100%)] gap-4"
              data-slot="update-dialog"
            >
              <div className="grid justify-items-center gap-1 text-center">
                <PythiaLockup
                  variant="mark"
                  decorative
                  className="text-[3rem]"
                />
                <Dialog.Title className="mt-2">
                  {phase === "available"
                    ? "New update available"
                    : "Pythia update"}
                </Dialog.Title>
                <Dialog.Description className="tabular-nums">
                  {versionLabel(flow.release)}
                </Dialog.Description>
              </div>
              <UpdateStatus compact />
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
