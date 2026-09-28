import type { DynamicToolUIPart } from "ai";
import { searchSnippet } from "./search-snippet";
import type { ToolView } from "./tool-copy";
import {
  codeLanguage,
  fileName,
  firstUrl,
  host,
  record,
  shorten,
  text,
} from "./tool-text";

/** Hermes wraps external content in an untrusted-data envelope. */
function unwrap(output: string) {
  const body = output
    .replace(/^\s*<untrusted_tool_result[^>]*>/u, "")
    .replace(/<\/untrusted_tool_result>\s*$/u, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return record(JSON.parse(body.slice(start, end + 1)));
  } catch {
    return null;
  }
}

/**
 * A stored result whose body reports an error. Hermes history carries no
 * error flag, so a failed call would otherwise read as done.
 */
export function outputReportsFailure(output: unknown) {
  if (typeof output !== "string") return false;
  const parsed = unwrap(output);
  if (!parsed) return false;
  if (parsed.error || parsed.status === "error") return true;
  if (typeof parsed.exit_code === "number" && parsed.exit_code !== 0)
    return true;
  return (
    typeof parsed.status === "string" &&
    ["missing_configuration", "failed", "unavailable"].includes(parsed.status)
  );
}

export type ToolLink = {
  title: string;
  url: string;
  site: string;
  snippet?: string;
};

export type ToolDetail =
  | { kind: "links"; links: ToolLink[] }
  | { kind: "code"; code: string; language: string; output?: string }
  | { kind: "files"; files: string[] }
  | { kind: "message"; text: string };

function links(items: unknown): ToolLink[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const entry = record(item);
    const url = typeof entry.url === "string" ? entry.url : "";
    if (!/^https?:\/\//iu.test(url)) return [];
    const title =
      typeof entry.title === "string" && entry.title.trim()
        ? shorten(entry.title, 110)
        : host(url);
    const snippet =
      typeof entry.description === "string"
        ? searchSnippet(entry.description, title)
        : "";
    return [{ title, url, site: host(url), ...(snippet ? { snippet } : {}) }];
  });
}

/** A readable reason from whatever error shape a tool returned. */
function errorMessage(parsed: Record<string, unknown> | null, raw: string) {
  const error = parsed?.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  const message = record(error).message;
  if (typeof message === "string" && message.trim()) return message.trim();
  if (parsed && typeof parsed.output === "string" && parsed.output.trim())
    return shorten(parsed.output, 400);
  return raw.trim() && !parsed ? shorten(raw, 400) : "";
}

/**
 * Only details a reader can use: search results and pages as links, code
 * with its output, files by name, and a failure's reason. Anything else has
 * no detail view at all rather than an empty or raw one.
 */
export function toolDetail(
  view: ToolView,
  part: DynamicToolUIPart,
  failed: boolean,
): ToolDetail {
  return (
    recordedDetail(view, part, failed) ?? {
      kind: "message",
      // Every step opens the same way: at least what it was asked to do.
      text:
        text(view.input, [
          "query",
          "urls",
          "url",
          "path",
          "file",
          "pattern",
          "ticker",
          "symbol",
          "company",
          "preview",
        ]) || "Nothing more was recorded for this step.",
    }
  );
}

function recordedDetail(
  view: ToolView,
  part: DynamicToolUIPart,
  failed: boolean,
): ToolDetail | null {
  const raw =
    part.state === "output-available" && typeof part.output === "string"
      ? part.output
      : part.state === "output-error"
        ? (part.errorText ?? "")
        : "";
  const parsed = raw ? unwrap(raw) : null;
  const { toolName, input } = view;
  if (toolName === "terminal" || toolName === "execute_code") {
    const code = text(input, ["command", "code", "preview"]);
    if (!code) return null;
    const output =
      typeof parsed?.output === "string" ? parsed.output.trim() : "";
    return {
      kind: "code",
      code,
      language: toolName === "terminal" ? "bash" : "python",
      ...(output ? { output } : {}),
    };
  }
  if (toolName === "write_file" && !failed) {
    const content = text(input, ["content"]);
    const path = text(input, ["path", "file"]);
    if (!content) return null;
    return { kind: "code", code: content, language: codeLanguage(path) };
  }
  if (failed) {
    const message = errorMessage(parsed, raw);
    return message ? { kind: "message", text: message } : null;
  }
  if (toolName === "web_search") {
    const data = record(parsed?.data);
    const found = links(data.web ?? parsed?.results ?? data.results);
    return found.length ? { kind: "links", links: found.slice(0, 6) } : null;
  }
  if (toolName === "web_extract" || toolName === "browser_navigate") {
    const found = links(parsed?.results);
    if (found.length) return { kind: "links", links: found };
    const url = firstUrl(text(input, ["urls", "url", "preview"]));
    return url
      ? { kind: "links", links: [{ title: host(url), url, site: host(url) }] }
      : null;
  }
  if (toolName === "search_files" || toolName === "list_files") {
    const files = Array.isArray(parsed?.files)
      ? parsed.files.flatMap((file) =>
          typeof file === "string" ? [fileName(file)] : [],
        )
      : [];
    return files.length ? { kind: "files", files: files.slice(0, 12) } : null;
  }
  return null;
}
