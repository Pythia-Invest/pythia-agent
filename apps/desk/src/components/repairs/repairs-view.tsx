"use client";

import {
  ActionDialog,
  Badge,
  type BadgeTone,
  Button,
  DataTable,
} from "@pythia/ui";
import Link from "next/link";
import { useState } from "react";
import { useLocalTime } from "@/client/local-time";
import { type Repair, type RepairStatus, useRepairs } from "@/client/repairs";
import { instrumentHref } from "@/components/instrument/instrument-href";
import { useIdentityKind } from "./identity-kind";
import type { RepairAction, RepairKind } from "./kinds";

const STATUS: Record<RepairStatus, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "warning" },
  agent: { label: "Answered by agent", tone: "info" },
  resolved: { label: "Resolved", tone: "success" },
  dismissed: { label: "Dismissed", tone: "neutral" },
};
const STATUS_OPTIONS = (Object.keys(STATUS) as RepairStatus[]).map((value) => ({
  value,
  label: STATUS[value].label,
}));

/** Settings → Repairs: what Pythia could not settle on its own, in the
 * back-office table. Rules and the agent normally fix these; the user may,
 * never has to. The Status filter shows answered and settled issues too. */
export function RepairsView() {
  const repairs = useRepairs();
  const time = useLocalTime();
  const kinds: Record<string, RepairKind> = {
    identity: useIdentityKind() as RepairKind,
  };
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>(["open", "agent"]);
  const [types, setTypes] = useState<string[]>([]);
  const [pending, setPending] = useState<{
    action: RepairAction;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const rows = repairs.all.filter(
    (repair) =>
      (!statuses.length || statuses.includes(repair.status)) &&
      (!types.length || types.includes(repair.kind)) &&
      (!needle || repair.search.includes(needle)),
  );
  const confirm = async (note: string) => {
    if (!pending) return;
    setPending({ ...pending, busy: true, error: null });
    try {
      setMessage(await pending.action.run(note));
      setPending(null);
    } catch (error) {
      setPending({
        ...pending,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div
      data-slot="repairs"
      className="min-h-0 flex-1 overflow-y-auto px-gutter py-6"
    >
      <div className="flex flex-col gap-4">
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
        {repairs.notice || message ? (
          <p
            role="status"
            className="m-0 rounded-control border border-border px-3 py-2 text-body text-foreground"
          >
            {message ?? repairs.notice}
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
        ) : null}
        <DataTable
          label="Repairs"
          rows={rows}
          rowKey={(repair) => repair.id}
          columns={[
            {
              key: "issue",
              header: "Issue",
              cell: (repair) => repair.title,
              text: (repair) => repair.description,
            },
            {
              key: "instrument",
              header: "Instrument",
              text: (repair) =>
                repair.subject?.name ?? repair.subject?.id ?? "",
              cell: (repair) =>
                repair.subject ? (
                  <Link
                    href={instrumentHref(repair.subject.id)}
                    className="text-foreground underline-offset-2 hover:underline"
                  >
                    {repair.subject.name ?? repair.subject.id}
                  </Link>
                ) : (
                  "—"
                ),
            },
            {
              key: "provider",
              header: "Provider",
              cell: (repair) => repair.plugin ?? "—",
              text: (repair) => repair.plugin ?? "",
            },
            {
              key: "status",
              header: "Status",
              cell: (repair) => (
                <Badge tone={STATUS[repair.status].tone}>
                  {STATUS[repair.status].label}
                </Badge>
              ),
            },
            {
              key: "created",
              header: "Created",
              className: "tabular-nums",
              cell: (repair) => time(repair.created, "compact"),
            },
            {
              key: "resolved",
              header: "Resolved",
              className: "tabular-nums",
              cell: (repair) =>
                repair.resolved ? time(repair.resolved, "compact") : "—",
            },
          ]}
          context={(repair: Repair) =>
            kinds[repair.kind]?.context(repair) ?? []
          }
          actions={(repair: Repair) =>
            (kinds[repair.kind]?.actions(repair) ?? []).map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.emphasis}
                title={action.hint}
                onClick={() => setPending({ action, busy: false, error: null })}
              >
                {action.label}
              </Button>
            ))
          }
          search={{
            value: query,
            onChange: setQuery,
            placeholder: "Search repairs…",
          }}
          filters={[
            {
              key: "status",
              label: "Status",
              options: STATUS_OPTIONS,
              selected: statuses,
              onChange: setStatuses,
            },
            {
              key: "type",
              label: "Type",
              options: Object.entries(kinds).map(([value, kind]) => ({
                value,
                label: kind.label,
              })),
              selected: types,
              onChange: setTypes,
            },
          ]}
          onRefresh={() => {
            setMessage(null);
            repairs.refetch();
          }}
          refreshing={repairs.isFetching}
          empty={
            repairs.isPending
              ? "Loading repairs…"
              : repairs.all.length
                ? "No repairs match these filters."
                : "Nothing needs attention."
          }
        />
      </div>
      {pending ? (
        <ActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          {...pending.action.dialog}
          pending={pending.busy}
          error={pending.error}
          onConfirm={(note) => void confirm(note)}
        />
      ) : null}
    </div>
  );
}
