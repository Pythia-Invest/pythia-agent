"use client";
import { PreviewToolbar } from "./toolbar";
import { Button } from "@pythia/ui";
import { useState } from "react";
import type { Table } from "@/workspace/previews/formats";
const PAGE = 100;
export function TablePreview({
  table,
  onSheet,
  page: requestedPage,
  onPage,
}: {
  table: Table;
  page: number;
  onPage: (page: number) => void;
  onSheet: (index: number) => void;
}) {
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(table.rows.length / PAGE) - 1),
  );
  const [formula, setFormula] = useState("");
  const columns = Math.max(0, ...table.rows.map((row) => row.length));
  return (
    <div data-slot="workspace-table" className="min-w-0">
      <PreviewToolbar label="Table tools">
        {table.names.length <= 1 ? (
          <span className="text-foreground-secondary">
            {table.names[0] || "Table"} · {table.rows.length} rows
          </span>
        ) : null}
        {table.names.length > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            Sheet
            <select
              aria-label="Worksheet"
              className="min-w-0 rounded-control border border-border bg-raised p-1 text-body"
              value={table.sheet}
              onChange={(e) => {
                onSheet(Number(e.target.value));
              }}
            >
              {table.names.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {table.rows.length > PAGE ? (
          <div className="flex items-center gap-2 text-xs">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
            >
              Previous rows
            </Button>
            <span>
              Page {page + 1} of {Math.ceil(table.rows.length / PAGE)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={(page + 1) * PAGE >= table.rows.length}
              onClick={() => onPage(page + 1)}
            >
              Next rows
            </Button>
          </div>
        ) : null}
      </PreviewToolbar>
      {formula ? (
        <p
          role="status"
          className="break-words rounded-control bg-subtle p-2 font-mono text-xs"
        >
          {formula}
        </p>
      ) : null}
      <div className="overflow-auto">
        <table className="w-full border-collapse text-body tabular-nums">
          <thead className="sticky top-0 bg-subtle">
            <tr>
              <th
                scope="col"
                className="border-border border-b px-2 py-1 text-left text-foreground-secondary"
              >
                #
              </th>
              {Array.from({ length: columns }, (_, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-border border-b px-2 py-1 text-left font-medium"
                >
                  {i < 26
                    ? String.fromCharCode(65 + i)
                    : `A${String.fromCharCode(65 + i - 26)}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows
              .slice(page * PAGE, (page + 1) * PAGE)
              .map((row, index) => (
                <tr
                  key={page * PAGE + index}
                  className="border-border border-b hover:bg-interaction-hover"
                >
                  <th
                    scope="row"
                    className="px-2 py-1 text-left font-normal text-foreground-secondary"
                  >
                    {page * PAGE + index + 1}
                  </th>
                  {row.map((value, c) => (
                    <td
                      key={c}
                      title={
                        table.formulas[`${page * PAGE + index}:${c}`] ?? value
                      }
                      className="max-w-80 whitespace-pre-wrap break-words px-2 py-1"
                    >
                      {value}
                      {table.formulas[`${page * PAGE + index}:${c}`] ? (
                        <button
                          type="button"
                          onClick={() =>
                            setFormula(
                              table.formulas[`${page * PAGE + index}:${c}`] ??
                                "",
                            )
                          }
                          className="ml-1 rounded-control px-1 text-foreground-secondary text-xs hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring"
                          aria-label={`Formula: ${table.formulas[`${page * PAGE + index}:${c}`]}`}
                        >
                          ƒ
                        </button>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!table.rows.length ? <p>No rows.</p> : null}
      {table.limited ? (
        <p className="text-foreground-secondary text-xs">
          Preview limits reached (rows, columns, sheets or cell text). Download
          the original for the complete workbook.
        </p>
      ) : null}
    </div>
  );
}
