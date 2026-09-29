import type { DynamicToolUIPart } from "ai";
import { fileName, host, readableQuery, record, text } from "./tool-text";

/**
 * Plain-language copy for Hermes tool calls. A reader should understand every
 * visible line without knowing a tool name, a shell command or a file path:
 * rows say what the agent did in ordinary words, and internal plumbing (tool
 * catalogue lookups, skill loading, reading its own agents' logs) is not shown
 * at all. Delegation and plans have their own presentation, so their calls
 * never render as ordinary rows either.
 */
export type ToolView = {
  /** The tool that did the work, read through Hermes's bridge wrappers. */
  toolName: string;
  input: Record<string, unknown>;
};

export type ToolCopy = {
  /** Not a step a reader needs to follow. */
  hidden: boolean;
  /** Short present tense for the single live status line. */
  status: string;
  /** The activity row while the call runs. */
  running: string;
  /** The activity row once it finished. */
  done: string;
  /** The activity row when it failed. */
  failed: string;
};

/**
 * Hermes reaches deferred plugin tools through `tool_call`, whose arguments
 * name the real tool.
 */
export function toolView(part: DynamicToolUIPart): ToolView {
  const input = record(part.input);
  if (part.toolName === "tool_call") {
    // Saved calls carry the inner tool's name; the live event only previews it.
    const named =
      typeof input.name === "string"
        ? input.name
        : typeof input.tool === "string"
          ? input.tool
          : "";
    const previewed =
      typeof input.preview === "string" && /^[\w.-]+$/u.test(input.preview)
        ? input.preview
        : "";
    const inner = named || previewed;
    if (previewed && !named) return { toolName: previewed, input: {} };
    if (inner)
      return {
        toolName: inner,
        input: {
          ...record(input.arguments ?? input.input ?? input.args),
          ...(input.preview ? { preview: input.preview } : {}),
        },
      };
  }
  return { toolName: part.toolName, input };
}

const PLUMBING = new Set([
  "tool_search",
  "tool_describe",
  "skill_view",
  "skills_list",
  "skill_manage",
  "pythia_desk_view",
  "delegate_task",
  "todo",
  "process",
]);

/** The subagent transcripts Hermes writes for the parent to read back. */
function agentLog(path: string) {
  const file = path.replace(/\s+L\d+(?:-\d+)?$/u, "");
  return /(?:^|\/)task-\d+\.log$/u.test(file) || file.includes("/delegation/");
}

function copy(
  status: string,
  done: string,
  failed: string,
  running = status,
): ToolCopy {
  return { hidden: false, status, running, done, failed };
}

const HIDDEN: ToolCopy = {
  hidden: true,
  status: "Thinking",
  running: "",
  done: "",
  failed: "",
};

export function toolCopy(view: ToolView): ToolCopy {
  const { toolName, input } = view;
  const preview = text(input, ["preview"]);
  if (PLUMBING.has(toolName)) {
    if (toolName === "delegate_task") {
      // Saved calls name the action; the live event previews it as
      // "<action> <subagent id>" (agent/display.py:build_tool_preview).
      const action =
        text(input, ["action"]) ||
        (/^(list|steer|stop)(?: \S+)?$/u.exec(preview)?.[1] ?? "");
      const status =
        action === "list" || action === "status"
          ? "Checking research agents"
          : action === "stop"
            ? "Stopping a research agent"
            : action === "steer"
              ? "Redirecting a research agent"
              : "Starting research agents";
      return { ...HIDDEN, status };
    }
    if (toolName === "todo") return { ...HIDDEN, status: "Planning" };
    return HIDDEN;
  }
  switch (toolName) {
    case "web_search": {
      const { terms, site } = readableQuery(text(input, ["query"]) || preview);
      const subject = terms ? `“${terms}”` : site;
      return copy(
        "Searching the web",
        subject ? `Searched the web for ${subject}` : "Searched the web",
        "A web search didn't work",
        subject ? `Searching the web for ${subject}` : "Searching the web",
      );
    }
    case "web_extract":
    case "browser_navigate": {
      const source = Array.isArray(input.urls)
        ? input.urls.join(" ")
        : text(input, ["urls", "url"]) || preview;
      const sites = [
        ...new Set(
          [...source.matchAll(/https?:\/\/[^\s'"\],]+/giu)].map((url) =>
            host(url[0]),
          ),
        ),
      ];
      const pages = source.match(/https?:\/\//giu)?.length ?? 0;
      const where =
        sites.length === 1
          ? pages > 1
            ? `${pages} pages on ${sites[0]}`
            : sites[0]
          : sites.length === 2
            ? `${sites[0]} and ${sites[1]}`
            : sites.length
              ? `${pages} pages`
              : "";
      return copy(
        where ? `Reading ${where}` : "Reading a page",
        where ? `Read ${where}` : "Read a page",
        where ? `Couldn't open ${where}` : "Couldn't open the page",
      );
    }
    case "terminal": {
      // The exact command is one click away; the row only says what kind.
      const python = /\bpython3?\b/u.test(text(input, ["command"]) || preview);
      return python
        ? copy(
            "Running a Python script",
            "Ran a Python script",
            "A Python script didn't finish",
          )
        : copy("Running a command", "Ran a command", "A command didn't finish");
    }
    case "execute_code":
      return copy(
        "Running a Python script",
        "Ran a Python script",
        "A Python script didn't finish",
      );
    case "read_file": {
      const path = text(input, ["path", "file", "filepath"]) || preview;
      if (agentLog(path)) return HIDDEN;
      const name = fileName(path);
      return copy(
        name ? `Reading ${name}` : "Reading a file",
        name ? `Read ${name}` : "Read a file",
        name ? `Couldn't read ${name}` : "Couldn't read a file",
      );
    }
    case "write_file":
    case "patch":
    case "edit_file": {
      const name = fileName(text(input, ["path", "file"]) || preview);
      const verb = toolName === "write_file" ? "Wrote" : "Edited";
      return copy(
        name
          ? `${verb === "Wrote" ? "Writing" : "Editing"} ${name}`
          : "Saving a file",
        name ? `${verb} ${name}` : `${verb} a file`,
        name ? `Couldn't save ${name}` : "Couldn't save a file",
      );
    }
    case "search_files":
    case "list_files":
      return copy(
        "Looking through your workspace",
        "Looked through your workspace",
        "Couldn't search your workspace",
      );
    case "session_search":
      return copy(
        "Checking earlier conversations",
        "Checked earlier conversations",
        "Couldn't search earlier conversations",
      );
    case "memory":
      return copy("Updating notes", "Updated notes", "Couldn't update notes");
    case "vision_analyze":
      return copy(
        "Looking at an image",
        "Looked at an image",
        "Couldn't read the image",
      );
    case "clarify":
      return copy("Asking you a question", "Asked you a question", "");
    case "pythia_sec_company": {
      const subject = text(input, ["ticker", "company", "symbol", "query"]);
      return copy(
        "Checking SEC filings",
        subject ? `Checked SEC filings for ${subject}` : "Checked SEC filings",
        "Couldn't reach SEC EDGAR",
      );
    }
    case "pythia_eod_prices": {
      const subject = text(input, ["ticker", "symbol", "tickers", "symbols"]);
      return copy(
        "Getting market prices",
        subject ? `Got closing prices for ${subject}` : "Got closing prices",
        subject ? `Couldn't get prices for ${subject}` : "Couldn't get prices",
      );
    }
    default: {
      if (toolName.startsWith("browser_"))
        return copy(
          "Using the browser",
          "Used the browser",
          "A browser step didn't work",
        );
      const name = toolName.replace(/^pythia_/u, "").replaceAll(/[_-]+/gu, " ");
      return copy(`Using ${name}`, `Used ${name}`, `Couldn't use ${name}`);
    }
  }
}
