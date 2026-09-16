import {
  extension,
  OFFICE_BYTES,
  TABLE_COLUMNS,
  TABLE_ROWS,
  type ParseInput,
  type PreviewResult,
} from "./formats";
import { parseNotebook } from "./notebook";

async function checkOfficeArchive(bytes: ArrayBuffer) {
  if (new Uint8Array(bytes)[0] !== 80 || new Uint8Array(bytes)[1] !== 75)
    return;
  const { unzipSync } = await import("fflate");
  let total = 0,
    entries = 0;
  // Inspect central-directory metadata without inflating file bodies. Office
  // parsing also runs in a disposable worker, outside the UI and host server.
  unzipSync(new Uint8Array(bytes), {
    filter: (file) => {
      total += file.originalSize;
      if (++entries > 2000 || total > 40 * 1024 * 1024)
        throw new Error("This document is too large to preview.");
      return false;
    },
  });
}
async function parseFile(input: ParseInput): Promise<PreviewResult> {
  if (input.bytes.byteLength > OFFICE_BYTES)
    throw new Error("This file is too large to preview.");
  if (input.kind === "notebook")
    return parseNotebook(new TextDecoder().decode(input.bytes));
  if (input.kind === "csv") {
    const Papa = (await import("papaparse")).default;
    const parsed = Papa.parse<string[]>(new TextDecoder().decode(input.bytes), {
      delimiter: extension(input.name) === "tsv" ? "\t" : "",
      dynamicTyping: false,
      skipEmptyLines: "greedy",
      preview: TABLE_ROWS + 1,
    });
    if (parsed.errors.some((e) => e.type === "Quotes"))
      throw new Error("This table has malformed quoted fields.");
    return {
      kind: "table",
      table: {
        names: [input.name],
        sheet: 0,
        rows: parsed.data
          .slice(0, TABLE_ROWS)
          .map((r) => r.slice(0, TABLE_COLUMNS)),
        formulas: {},
        limited:
          Boolean(parsed.meta.truncated) ||
          parsed.data.length > TABLE_ROWS ||
          parsed.data.some((r) => r.length > TABLE_COLUMNS),
      },
    };
  }
  await checkOfficeArchive(input.bytes);
  if (input.kind === "document") {
    const mammoth = (await import("mammoth/mammoth.browser")).default;
    const result = await mammoth.convertToHtml(
      { arrayBuffer: input.bytes },
      { externalFileAccess: false, includeEmbeddedStyleMap: false },
    );
    if (
      result.value.length > 1_000_000 ||
      (result.value.match(/</g)?.length ?? 0) > 10_000
    )
      throw new Error("This document is too large to preview.");
    return { kind: "document", html: result.value };
  }
  const XLSX = await import("xlsx");
  const names = XLSX.read(input.bytes, {
    type: "array",
    bookSheets: true,
  }).SheetNames;
  const index = Math.max(0, Math.min(input.sheet, names.length - 1));
  const book = XLSX.read(input.bytes, {
    type: "array",
    sheets: index,
    sheetRows: TABLE_ROWS,
    cellHTML: false,
    cellText: true,
    cellFormula: true,
    bookVBA: false,
  });
  const sheet = book.Sheets[names[index] ?? ""];
  if (!sheet) throw new Error("This workbook has no readable sheets.");
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const full = XLSX.utils.decode_range(
    sheet["!fullref"] ?? sheet["!ref"] ?? "A1",
  );
  const rows: string[][] = [],
    formulas: Record<string, string> = {};
  for (let r = 0; r <= Math.min(range.e.r, TABLE_ROWS - 1); r++) {
    const row: string[] = [];
    for (let c = 0; c <= Math.min(range.e.c, TABLE_COLUMNS - 1); c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(
        cell?.f && cell.v === undefined
          ? "Value unavailable"
          : String(cell?.w ?? cell?.v ?? ""),
      );
      if (cell?.f) formulas[`${r}:${c}`] = `=${cell.f}`;
    }
    rows.push(row);
  }
  return {
    kind: "table",
    table: {
      names: names.slice(0, 100),
      sheet: index,
      rows,
      formulas,
      limited:
        full.e.r >= TABLE_ROWS ||
        full.e.c >= TABLE_COLUMNS ||
        names.length > 100,
    },
  };
}

/** Bound the rendered payload independently of archive/input size. */
export async function parsePreview(input: ParseInput): Promise<PreviewResult> {
  const result = await parseFile(input);
  if (result.kind !== "table") return result;
  let remaining = 200_000;
  function bounded(value: string) {
    const count = Math.min(2000, remaining);
    const clipped = value.slice(0, count);
    remaining -= clipped.length;
    if (clipped.length < value.length) {
      if (result.kind === "table") result.table.limited = true;
      return `${clipped}…`;
    }
    return clipped;
  }
  result.table.rows = result.table.rows.map((row) => row.map(bounded));
  for (const key of Object.keys(result.table.formulas))
    result.table.formulas[key] = bounded(result.table.formulas[key] ?? "");
  return result;
}
