import { expect, it } from "vitest";
import { parsePreview } from "@/workspace/previews/parse";
import { codeLanguage, OFFICE_BYTES } from "@/workspace/previews/formats";
import { parseNotebook } from "@/workspace/previews/notebook";
import { describeBytes } from "@/server/workspace/files";
import type { Stats } from "node:fs";
import { documentBytes, workbookBytes } from "./workspace-format-fixtures";
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
it("parses quoted CSV and preserves identifiers and formula-like strings", async () => {
  const result = await parsePreview({
    kind: "csv",
    name: "data.csv",
    sheet: 0,
    bytes: bytes('Code,Value\n00123,"hello, world"\n=1+2,"line one\nline two"'),
  });
  expect(result.kind === "table" && result.table.rows).toEqual([
    ["Code", "Value"],
    ["00123", "hello, world"],
    ["=1+2", "line one\nline two"],
  ]);
});
it("bounds table rows and columns", async () => {
  const result = await parsePreview({
    kind: "csv",
    name: "data.tsv",
    sheet: 0,
    bytes: bytes(
      Array.from({ length: 1100 }, () => Array(60).fill("x").join("\t")).join(
        "\n",
      ),
    ),
  });
  if (result.kind !== "table") throw new Error("Wrong preview");
  expect(result.table.rows).toHaveLength(1000);
  expect(result.table.rows[0]).toHaveLength(50);
  expect(result.table.limited).toBe(true);
});
it("shows formatted spreadsheet values and missing formula results without recalculation", async () => {
  const input = {
    kind: "spreadsheet" as const,
    name: "model.xlsx",
    sheet: 0,
    bytes: workbookBytes(),
  };
  const result = await parsePreview(input);
  if (result.kind !== "table") throw new Error("Wrong preview");
  expect(result.table.names).toEqual(["Comparison", "Assumptions"]);
  expect(result.table.rows[1]?.[2]).toBe("20.0%");
  expect(result.table.formulas["2:2"]).toBe("=B2*2");
  const other = await parsePreview({ ...input, sheet: 1 });
  expect(other.kind === "table" && other.table.rows[1]?.[0]).toBe(
    "Fictional data",
  );
});
it("converts DOCX paragraphs and tables", async () => {
  const result = await parsePreview({
    kind: "document",
    name: "memo.docx",
    sheet: 0,
    bytes: documentBytes(),
  });
  expect(result.kind === "document" && result.html).toContain(
    "Fictional investment memo",
  );
  expect(result.kind === "document" && result.html).toContain("<table>");
});
it("keeps notebook HTML, widgets and JavaScript inert", () => {
  const result = parseNotebook(
    JSON.stringify({
      nbformat: 4,
      cells: [
        {
          cell_type: "code",
          source: ["print(1)"],
          outputs: [
            {
              data: {
                "text/html": "<script>evil()</script>",
                "application/javascript": "evil()",
                "text/plain": "1",
              },
            },
          ],
        },
      ],
    }),
  );
  expect(JSON.stringify(result)).not.toContain("evil");
  expect(result.kind === "notebook" && result.cells[0]?.output).toBe("1");
});
it("rejects oversized and malformed inputs", async () => {
  await expect(
    parsePreview({
      kind: "spreadsheet",
      name: "big.xlsx",
      sheet: 0,
      bytes: new ArrayBuffer(OFFICE_BYTES + 1),
    }),
  ).rejects.toThrow("too large");
  await expect(
    parsePreview({
      kind: "notebook",
      name: "bad.ipynb",
      sheet: 0,
      bytes: bytes("{}"),
    }),
  ).rejects.toThrow("Unsupported");
});
it.each([
  ["model.mjs", "javascript"],
  ["types.mts", "typescript"],
  ["engine.rs", "rust"],
  ["Dockerfile", "dockerfile"],
  ["unknown.xyz", "text"],
])("maps %s to a maintained grammar", (name, lang) =>
  expect(codeLanguage(name)).toBe(lang),
);
it("recognizes passive previews without making HTML or SVG executable", () => {
  const stat = {
    isDirectory: () => false,
    size: 100,
    mtime: new Date(0),
  } as Stats;
  expect(
    describeBytes("script.mjs", stat, Buffer.from("const a = 1")).kind,
  ).toBe("text");
  expect(
    describeBytes("page.html", stat, Buffer.from("<script>evil()</script>"))
      .mediaType,
  ).toBe("text/plain; charset=utf-8");
  expect(
    describeBytes("model.xlsx", stat, Buffer.from(workbookBytes())).kind,
  ).toBe("spreadsheet");
  expect(
    describeBytes("memo.docx", stat, Buffer.from(documentBytes())).kind,
  ).toBe("document");
});

it("bounds individual cells and marks truncated notebook cells", async () => {
  const result = await parsePreview({
    kind: "csv",
    name: "long.csv",
    sheet: 0,
    bytes: bytes(`a,${"x".repeat(20_000)}`),
  });
  if (result.kind !== "table") throw new Error("Wrong preview");
  expect(result.table.rows[0]?.[1]?.length).toBeLessThanOrEqual(2001);
  expect(result.table.limited).toBe(true);
  const book = parseNotebook(
    JSON.stringify({
      nbformat: 4,
      cells: [{ cell_type: "code", source: "x".repeat(20_000) }],
    }),
  );
  expect(book.kind === "notebook" && book.limited).toBe(true);
});

it("preserves saved execution counts without substituting cell positions", () => {
  const result = parseNotebook(
    JSON.stringify({
      nbformat: 4,
      cells: [
        {
          cell_type: "code",
          execution_count: 7,
          source: "2 + 2",
          outputs: [
            {
              output_type: "execute_result",
              execution_count: 7,
              data: { "text/plain": "4" },
            },
          ],
        },
        { cell_type: "code", execution_count: null, source: "pending" },
        { cell_type: "code", execution_count: "<script>", source: "invalid" },
        {
          cell_type: "code",
          execution_count: 8,
          source: "print(4)",
          outputs: [{ output_type: "stream", text: "4" }],
        },
      ],
    }),
  );
  if (result.kind !== "notebook") throw new Error("Expected notebook");
  expect(result.cells[0]).toMatchObject({ executionCount: 7, outputCount: 7 });
  expect(result.cells[1]?.executionCount).toBeUndefined();
  expect(result.cells[2]?.executionCount).toBeUndefined();
  expect(result.cells[3]?.outputCount).toBeUndefined();
});
