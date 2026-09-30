"use client";

import { PythiaLockup } from "@pythia/ui";
import { useUpdateFlow } from "@/client/update-flow";
import { UpdateStatus, versionLabel } from "@/components/updates/update-status";

/** About › Version & updates: who this is, which version, and updates. */
export function AboutPage() {
  const { release } = useUpdateFlow();
  return (
    <div className="mx-auto grid max-w-2xl gap-6 pt-6">
      <div className="grid justify-items-center gap-1 text-center">
        <PythiaLockup variant="mark" decorative className="text-[4rem]" />
        <h2 className="m-0 mt-2 font-semibold text-lg tracking-tight">
          Pythia
        </h2>
        <p
          className="m-0 text-foreground-secondary text-xs tabular-nums"
          title={release?.current_revision}
        >
          {versionLabel(release)}
        </p>
      </div>
      <UpdateStatus />
    </div>
  );
}
