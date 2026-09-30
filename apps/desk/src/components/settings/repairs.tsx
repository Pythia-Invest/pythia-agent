"use client";

import Link from "next/link";
import { useRepairs } from "@/client/repairs";
import { ListRow } from "./primitives";

/** Issues Pythia could not settle on its own. The agent may suggest an
 * answer; it counts once the investor confirms it. The list is a page of its
 * own because each issue needs room for its context. */
export function RepairsPage() {
  const repairs = useRepairs();
  const open = repairs.open.length;
  return (
    <div data-slot="repairs-settings">
      <p className="m-0 mb-2 text-body text-foreground-secondary leading-ui">
        Issues Pythia could not settle on its own. The agent may suggest an
        answer; it counts once you confirm it.
      </p>
      <ListRow
        title="Open issues"
        description={
          repairs.error
            ? "Repairs could not be read."
            : open
              ? `${open} open ${open === 1 ? "issue" : "issues"}.`
              : "Nothing needs attention."
        }
        action={
          <Link
            href="/settings/repairs"
            className="font-medium text-body text-foreground underline-offset-2 hover:underline"
          >
            Open repairs
          </Link>
        }
      />
    </div>
  );
}
