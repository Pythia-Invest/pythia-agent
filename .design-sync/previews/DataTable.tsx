import { Badge, Button, DataTable } from "@pythia/ui";

const tasks = [
  { id: "T-104", type: "Northstar feed gap", status: "Open", created: "2029-03-14 15:45" },
  { id: "T-103", type: "Kestrel record mismatch", status: "Open", created: "2029-03-14 15:42" },
  { id: "T-102", type: "Northstar feed gap", status: "Resolved", created: "2029-03-14 13:03" },
];

export function TaskList() {
  return (
    <DataTable
      actions={(task) =>
        task.status === "Open" ? (
          <>
            <Button size="sm">Resolve</Button>
            <Button size="sm" variant="secondary">
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
            <Badge tone={task.status === "Open" ? "warning" : "success"}>{task.status}</Badge>
          ),
        },
        { key: "created", header: "Created", cell: (task) => task.created },
      ]}
      context={(task) => [{ label: "Reference", value: `${task.id}-SYN` }]}
      filters={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "Open", label: "Open" },
            { value: "Resolved", label: "Resolved" },
          ],
          selected: ["Open"],
          onChange: () => undefined,
        },
      ]}
      label="Synthetic tasks"
      onRefresh={() => undefined}
      rowKey={(task) => task.id}
      rows={tasks}
      search={{ value: "", onChange: () => undefined, placeholder: "Search context…" }}
    />
  );
}
