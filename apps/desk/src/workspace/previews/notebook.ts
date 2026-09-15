import {
  TEXT_RENDER_CHARS,
  type NotebookCell,
  type PreviewResult,
} from "./formats";
function executionCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
function text(value: unknown): string {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.filter((v) => typeof v === "string").join("")
      : "";
}
/** Saved, passive outputs only. Never execute kernels, HTML, JS or widgets. */
export function parseNotebook(source: string): PreviewResult {
  const book = JSON.parse(source);
  if (book?.nbformat !== 4 || !Array.isArray(book.cells))
    throw new Error("Unsupported notebook format.");
  let remaining = TEXT_RENDER_CHARS;
  let clipped = false;
  function limited(value: unknown) {
    const full = text(value);
    const result = full.slice(0, Math.min(10_000, remaining));
    if (result.length < full.length) clipped = true;
    return result;
  }
  const cells: NotebookCell[] = [];
  for (const cell of book.cells.slice(0, 100)) {
    if (remaining <= 0) break;
    if (!cell || typeof cell !== "object") continue;
    const source = limited(cell.source);
    remaining -= source.length;
    let output = "",
      image: string | undefined;
    for (const item of (Array.isArray(cell.outputs) ? cell.outputs : []).slice(
      0,
      20,
    )) {
      if (!item || typeof item !== "object") continue;
      const value = limited(
        item.text ?? item.data?.["text/plain"] ?? item.traceback,
      ).slice(0, Math.max(0, remaining));
      output += value;
      remaining -= value.length;
      const png = item.data?.["image/png"];
      if (
        !image &&
        typeof png === "string" &&
        png.length < 1_000_000 &&
        /^[A-Za-z0-9+/=\r\n]+$/.test(png)
      )
        image = `data:image/png;base64,${png}`;
    }
    const count = executionCount(cell.execution_count);
    const onlyOutput = cell.outputs?.length === 1 ? cell.outputs[0] : undefined;
    const outputCount =
      onlyOutput?.output_type === "execute_result"
        ? executionCount(onlyOutput.execution_count)
        : undefined;
    cells.push({
      ...(cell.cell_type === "code" && count !== undefined
        ? { executionCount: count }
        : {}),
      ...(outputCount !== undefined ? { outputCount } : {}),
      kind:
        cell.cell_type === "markdown"
          ? "markdown"
          : cell.cell_type === "code"
            ? "code"
            : "raw",
      source,
      output,
      ...(image ? { image } : {}),
    });
  }
  return {
    kind: "notebook",
    language: text(book.metadata?.language_info?.name).slice(0, 80) || "python",
    cells,
    limited: book.cells.length > cells.length || remaining <= 0 || clipped,
  };
}
