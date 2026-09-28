import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "../src/data-display/data-table";

const rows = [{ id: "t-1", type: "Synthetic check", status: "Open" }];
const columns = [
  { key: "id", header: "ID", cell: (row: (typeof rows)[number]) => row.id },
  {
    key: "type",
    header: "Type",
    cell: (row: (typeof rows)[number]) => row.type,
  },
];

describe("back-office data table semantics", () => {
  it("names the table, labels its search and filter count, and collapses context by default", () => {
    const html = renderToStaticMarkup(
      <DataTable
        actions={() => <button type="button">Resolve</button>}
        columns={columns}
        context={() => [{ label: "Reference", value: "SYN-1" }]}
        filters={[
          {
            key: "status",
            label: "Status",
            onChange: () => undefined,
            options: [{ value: "open", label: "Open" }],
            selected: ["open"],
          },
        ]}
        label="Synthetic tasks"
        rowKey={(row) => row.id}
        rows={rows}
        search={{
          onChange: () => undefined,
          placeholder: "Search context",
          value: "",
        }}
      />,
    );
    expect(html).toContain('aria-label="Synthetic tasks"');
    expect(html).toContain('aria-label="Search context"');
    expect(html).toContain('1<span class="sr-only"> selected</span>');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Resolve");
    expect(html).not.toContain("SYN-1");
  });

  it("says so when no row is left", () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns}
        empty="No synthetic tasks."
        label="Synthetic tasks"
        rowKey={(row) => row.id}
        rows={[]}
      />,
    );
    expect(html).toContain('colSpan="2"');
    expect(html).toContain("No synthetic tasks.");
  });
});
