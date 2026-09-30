/** Shared plain-text helpers for Hermes tool calls: inputs, links, files. */

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string")
      return String(value[0]).trim();
  }
  return "";
}

export function shorten(value: string, max = 72) {
  const clean = value.replace(/\s+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** "site:x.com "Q3 2026" apple OR aapl" → "Q3 2026 apple aapl". */
export function readableQuery(query: string) {
  const sites = [...query.matchAll(/\bsite:(\S+)/giu)].map((match) =>
    host(match[1] ?? ""),
  );
  const words = query
    .replace(/\b(?:site|filetype|inurl|intitle|before|after):\S+/giu, " ")
    .replace(/(^|\s)-\S+/gu, " ")
    .replace(/\b(?:OR|AND)\b/gu, " ")
    .replace(/["“”()]/gu, " ");
  const clean = shorten(words, 64);
  if (clean) return { terms: clean, site: sites[0] ?? "" };
  return { terms: "", site: sites[0] ?? "" };
}

/** "https://www.sec.gov/Archives/…" → "sec.gov". */
export function host(url: string) {
  const match = /https?:\/\/([^/\s'"\])]+)/iu.exec(url);
  const name = (match?.[1] ?? url.split("/")[0] ?? "").toLowerCase();
  return name.replace(/^www\./u, "");
}

export function firstUrl(value: string) {
  return /https?:\/\/[^\s'"\],]+/iu.exec(value)?.[0] ?? "";
}

export function fileName(path: string) {
  const name = path
    .replace(/\s+L\d+(?:-\d+)?$/u, "")
    .split(/[\\/]/u)
    .filter(Boolean)
    .at(-1);
  return name ?? path;
}

const LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  json: "json",
  md: "markdown",
  csv: "csv",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
};

export function codeLanguage(path: string) {
  return LANGUAGES[path.split(".").at(-1)?.toLowerCase() ?? ""] ?? "text";
}
