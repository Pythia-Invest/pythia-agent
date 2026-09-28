"use client";

import {
  ActionDialog,
  Badge,
  type BadgeTone,
  Button,
  DataTable,
} from "@pythia/ui";
import { useState } from "react";

type Status = "open" | "resolved" | "cancelled";

interface Task {
  id: string;
  type: string;
  status: Status;
  created: string;
  completed: string | null;
  reference: string;
  detail: string;
}

const TONES: Record<Status, BadgeTone> = {
  open: "warning",
  resolved: "success",
  cancelled: "neutral",
};
const LABELS: Record<Status, string> = {
  open: "Open",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const TASKS: Task[] = [
  {
    id: "T-104",
    type: "Northstar feed gap",
    status: "open",
    created: "2029-03-14 15:45",
    completed: null,
    reference: "NS-ALPHA-7",
    detail: "No synthetic prices arrived for 36 minutes.",
  },
  {
    id: "T-103",
    type: "Kestrel record mismatch",
    status: "open",
    created: "2029-03-14 15:42",
    completed: null,
    reference: "KL-BETA-2",
    detail: "The synthetic record names another venue than the reference.",
  },
  {
    id: "T-102",
    type: "Northstar feed gap",
    status: "resolved",
    created: "2029-03-14 13:03",
    completed: "2029-03-14 13:20",
    reference: "NS-ALPHA-6",
    detail: "Recovered after a synthetic retry.",
  },
  {
    id: "T-101",
    type: "Kestrel record mismatch",
    status: "cancelled",
    created: "2029-03-13 09:12",
    completed: "2029-03-13 09:30",
    reference: "KL-BETA-1",
    detail: "No longer relevant.",
  },
];

/** Synthetic back-office list: the owner filters rows; the table only presents them. */
export function DataTableDemo() {
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<string[]>(["open"]);
  const [types, setTypes] = useState<string[]>([]);
  const [action, setAction] = useState<{
    task: Task;
    kind: "resolve" | "cancel";
  } | null>(null);
  const [log, setLog] = useState("");
  const typeNames = [...new Set(TASKS.map((task) => task.type))];
  const rows = TASKS.filter(
    (task) =>
      (!statuses.length || statuses.includes(task.status)) &&
      (!types.length || types.includes(task.type)) &&
      `${task.id} ${task.type} ${task.reference} ${task.detail}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-2">
      <DataTable
        actions={(task) =>
          task.status === "open" ? (
            <>
              <Button
                onClick={() => setAction({ task, kind: "resolve" })}
                size="sm"
              >
                Resolve
              </Button>
              <Button
                onClick={() => setAction({ task, kind: "cancel" })}
                size="sm"
                variant="secondary"
              >
                Cancel
              </Button>
            </>
          ) : null
        }
        columns={[
          { key: "id", header: "ID", cell: (task) => task.id },
          { key: "type", header: "Type", cell: (task) => task.type },
          {
            key: "status",
            header: "Status",
            cell: (task) => (
              <Badge tone={TONES[task.status]}>{LABELS[task.status]}</Badge>
            ),
          },
          { key: "created", header: "Created", cell: (task) => task.created },
          {
            key: "completed",
            header: "Completed",
            cell: (task) => task.completed ?? "—",
          },
        ]}
        context={(task) => [
          { label: "Reference", value: task.reference },
          { label: "Issue", value: task.detail },
        ]}
        empty="No synthetic tasks match."
        filters={[
          {
            key: "status",
            label: "Status",
            options: (Object.keys(LABELS) as Status[]).map((value) => ({
              value,
              label: LABELS[value],
            })),
            selected: statuses,
            onChange: setStatuses,
          },
          {
            key: "type",
            label: "Type",
            options: typeNames.map((value) => ({ value, label: value })),
            selected: types,
            onChange: setTypes,
          },
        ]}
        label="Synthetic tasks"
        onRefresh={() => setLog("Refreshed the synthetic list.")}
        rowKey={(task) => task.id}
        rows={rows}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search context…",
        }}
      />
      <ActionDialog
        confirmLabel={
          action?.kind === "cancel" ? "Cancel task" : "Resolve task"
        }
        description={
          action?.kind === "cancel"
            ? "Cancel this task if it is no longer relevant."
            : "Mark this task as resolved and say how."
        }
        noteLabel={
          action?.kind === "cancel" ? "Cancellation reason" : "Resolution note"
        }
        notePlaceholder={
          action?.kind === "cancel"
            ? "Explain why this task is cancelled…"
            : "Describe how this task was resolved…"
        }
        onConfirm={(note) => {
          setLog(
            `${action?.kind === "cancel" ? "Cancelled" : "Resolved"} ${action?.task.id}${note ? `: ${note}` : ""}`,
          );
          setAction(null);
        }}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        open={action !== null}
        title={action?.kind === "cancel" ? "Cancel task" : "Resolve task"}
        tone={action?.kind === "cancel" ? "danger" : "primary"}
      />
      {log ? (
        <p className="m-0 text-foreground-secondary text-xs" role="status">
          {log}
        </p>
      ) : null}
    </div>
  );
}
