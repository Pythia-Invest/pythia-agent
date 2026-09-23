import { compoundFileType, fileExtension } from "../file-types";

/** Small presentation map, not executable language support. Unknown UTF-8 files
 * can still be inspected as text; HTML and SVG are always shown as source. */
export const languages: Record<string, string> = {
  py: "python",
  pyw: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  rs: "rust",
  go: "go",
  r: "r",
  jl: "julia",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  rb: "ruby",
  php: "php",
  lua: "lua",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  bat: "bat",
  cmd: "bat",
  sql: "sql",
  json: "json",
  jsonl: "json",
  ndjson: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  xml: "xml",
  svg: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  tex: "latex",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
  graphql: "graphql",
  proto: "proto",
  vue: "vue",
  svelte: "svelte",
  mdx: "mdx",
};
export function extension(path: string) {
  return fileExtension(path).slice(1);
}
export function codeLanguage(path: string) {
  const name = path.split("/").at(-1)?.toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile") return "makefile";
  return (
    compoundFileType(path)?.language ?? languages[extension(path)] ?? "text"
  );
}
export const OFFICE_BYTES = 10 * 1024 * 1024;
export const TEXT_RENDER_CHARS = 100_000;
export const TABLE_ROWS = 1000;
export const TABLE_COLUMNS = 50;
export type ParsedKind = "csv" | "spreadsheet" | "document" | "notebook";
export type Table = {
  names: string[];
  sheet: number;
  rows: string[][];
  formulas: Record<string, string>;
  limited: boolean;
};
export type NotebookCell = {
  executionCount?: number;
  outputCount?: number;
  kind: "markdown" | "code" | "raw";
  source: string;
  output: string;
  image?: string;
};
export type PreviewResult =
  | { kind: "table"; table: Table }
  | { kind: "document"; html: string }
  | {
      kind: "notebook";
      language: string;
      cells: NotebookCell[];
      limited: boolean;
    };
export type ParseInput = {
  kind: ParsedKind;
  bytes: ArrayBuffer;
  name: string;
  sheet: number;
};
