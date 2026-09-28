"use client";

import { Badge, type BadgeTone, Button } from "@pythia/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { useLocalTime } from "@/client/local-time";
import {
  type IdentityRepair,
  type Repair,
  type RepairStatus,
  useRepairs,
} from "@/client/repairs";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { IdentityFix } from "./identity-fix";

/** A kind is only the renderer of its detail and fix flow. */
const KINDS: Record<string, (repair: Repair) => ReactNode> = {
  identity: (repair) => <IdentityFix repair={repair as IdentityRepair} />,
};

const STATUS: Record<RepairStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "warning" },
  agent: { label: "Answered by the agent (provisional)", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};

/** Settings → Repairs: what Pythia could not settle on its own. The agent
 * normally fixes these; the user may, never has to. What the agent answered
 * stays in a collapsed history, to confirm or override. */
export function RepairsView() {
  const repairs = useRepairs();
  return (
    <div
      data-slot="repairs"
      className="min-h-0 flex-1 overflow-y-auto px-gutter py-6"
    >
      <div className="flex max-w-measure flex-col gap-4">
        <div>
          <Link
            href="/settings"
            className="text-foreground-secondary text-xs hover:text-foreground"
          >
            ← Settings
          </Link>
          <h2 className="m-0 mt-2 font-semibold text-[1.125rem] text-foreground leading-tight">
            Repairs
          </h2>
          <p className="mt-1 mb-0 text-body text-foreground-secondary leading-ui">
            Issues Pythia could not settle on its own. Rules and the agent
            normally fix these; you can also fix one yourself.
          </p>
        </div>
        {repairs.notice ? (
          <p
            role="status"
            className="m-0 rounded-control border border-border px-3 py-2 text-body text-foreground"
          >
            {repairs.notice}
          </p>
        ) : null}
        {repairs.error ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="m-0 text-error text-xs">
              Repairs could not be read. {repairs.error.message}
            </p>
            <Button size="sm" variant="ghost" onClick={repairs.refetch}>
              Retry
            </Button>
          </div>
        ) : repairs.isPending ? (
          <p role="status" className="m-0 text-body text-foreground-secondary">
            Loading repairs…
          </p>
        ) : repairs.open.length ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {repairs.open.map((repair) => (
              <RepairCard key={repair.id} repair={repair} />
            ))}
          </ul>
        ) : (
          <p className="m-0 text-body text-foreground-secondary">
            Nothing needs attention.
          </p>
        )}
        {repairs.history.length ? (
          <details className="rounded-container border border-border/60 px-4 py-3">
            <summary className="cursor-pointer font-semibold text-body text-foreground">
              History ({repairs.history.length})
            </summary>
            <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
              {repairs.history.map((repair) => (
                <RepairCard key={repair.id} repair={repair} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function RepairCard({ repair }: { repair: Repair }) {
  const time = useLocalTime();
  const status = STATUS[repair.status];
  const render = KINDS[repair.kind];
  return (
    <li
      data-slot="repair"
      data-kind={repair.kind}
      className="flex flex-col gap-2 rounded-container border border-border/60 bg-container p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-semibold text-body text-foreground">
          {repair.title}
        </h3>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="m-0 text-body text-foreground-secondary leading-ui">
        {repair.description}
      </p>
      <p className="m-0 flex flex-wrap gap-x-2 text-foreground-secondary text-xs">
        {repair.subject ? (
          <Link
            href={instrumentHref(repair.subject.id)}
            className="text-foreground hover:underline"
          >
            {repair.subject.name ?? repair.subject.id}
          </Link>
        ) : null}
        {repair.plugin ? <span>{repair.plugin}</span> : null}
        <span>{time(repair.created, "compact")}</span>
      </p>
      {render ? render(repair) : null}
    </li>
  );
}
