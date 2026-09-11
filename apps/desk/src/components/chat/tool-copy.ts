import type { DynamicToolUIPart } from "ai";

/**
 * Plain-language copy for Hermes tool calls. Every row inside the process
 * block reads as "what the agent did to what": a verb from the tool's kind
 * and a target from its arguments or Hermes's own preview text.
 */
export type ToolKind =
  | "lookup"
  | "skill"
  | "explore"
  | "edit"
  | "run"
  | "delegate"
  | "memory"
  | "plan"
  | "other";

const KIND_COPY: Record<ToolKind, { past: string; present: string }> = {
  delegate: {
    past: "Delegated",
    present: "Delegating",
  },
  edit: { past: "Edited", present: "Editing" },
  explore: {
    past: "Explored",
    present: "Exploring",
  },
  lookup: { past: "Looked up", present: "Looking up" },
  memory: { past: "Saved", present: "Saving" },
  other: { past: "Used", present: "Using" },
  plan: { past: "Updated", present: "Updating" },
  run: { past: "Ran", present: "Running" },
  skill: { past: "Read", present: "Reading" },
};

const LOOKUP_TOOLS = new Set(["tool_search", "tool_describe"]);
const SKILL_TOOLS = new Set(["skill_view", "skills_list", "skill_manage"]);
const EDIT_TOOLS = new Set(["edit_file", "patch", "write_file"]);
const RUN_TOOLS = new Set(["terminal", "execute_code"]);
const EXPLORE_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "session_search",
  "vision_analyze",
  "web_extract",
  "web_search",
]);

export function toolKind(toolName: string): ToolKind {
  if (LOOKUP_TOOLS.has(toolName)) return "lookup";
  if (SKILL_TOOLS.has(toolName)) return "skill";
  if (EDIT_TOOLS.has(toolName)) return "edit";
  if (RUN_TOOLS.has(toolName)) return "run";
  if (toolName === "delegate_task") return "delegate";
  if (toolName === "memory") return "memory";
  if (toolName === "todo") return "plan";
  if (
    EXPLORE_TOOLS.has(toolName) ||
    toolName.startsWith("browser_") ||
    toolName.startsWith("pythia_")
  ) {
    return "explore";
  }
  return "other";
}

export type ToolView = {
  /** The tool that did the work, read through Hermes's bridge wrappers. */
  toolName: string;
  input: Record<string, unknown>;
  kind: ToolKind;
};

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Hermes reaches deferred plugin tools through `tool_call`, whose arguments
 * name the real tool. `tool_search` and `tool_describe` are the agent looking
 * the catalogue up, not the work itself, so they stay their own kind.
 */
export function toolView(part: DynamicToolUIPart): ToolView {
  const input = record(part.input);
  if (part.toolName === "tool_call") {
    const inner =
      typeof input.name === "string"
        ? input.name
        : typeof input.tool === "string"
          ? input.tool
          : "";
    if (inner) {
      return {
        toolName: inner,
        input: {
          ...record(input.arguments ?? input.input ?? input.args),
          ...(input.preview ? { preview: input.preview } : {}),
        },
        kind: toolKind(inner),
      };
    }
  }
  return { toolName: part.toolName, input, kind: toolKind(part.toolName) };
}

/** "web_search" → "web search"; a label when no better target is known. */
export function humanToolName(toolName: string) {
  return toolName.replace(/^pythia_/u, "").replaceAll(/[_-]+/g, " ");
}

function firstString(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** What the call acted on, from live preview text or stored arguments. */
export function toolTarget(view: ToolView) {
  const { input } = view;
  const preview = firstString(input, ["preview"]);
  if (preview) return preview;
  const command = firstString(input, ["command", "code"]);
  if (command) return command.split(/\r?\n/u)[0] ?? command;
  const path = firstString(input, ["path", "file", "filepath", "file_path"]);
  if (path) return path.split("/").filter(Boolean).at(-1) ?? path;
  if (view.kind === "skill") return firstString(input, ["name"]);
  if (view.kind === "delegate") {
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    const goal = firstString(record(tasks[0]), ["goal", "task"]);
    if (goal) return tasks.length > 1 ? `${tasks.length} tasks` : goal;
  }
  return firstString(input, [
    "query",
    "url",
    "ticker",
    "company",
    "symbol",
    "goal",
    "target",
  ]);
}

/** Row label: "Exploring ASML EUV" while pending, "Explored ASML EUV" after. */
export function toolLabel(view: ToolView, pending: boolean) {
  const copy = KIND_COPY[view.kind];
  const verb = pending ? copy.present : copy.past;
  if (view.kind === "plan") return `${verb} the plan`;
  if (view.kind === "memory") return pending ? "Using memory" : "Used memory";
  if (view.toolName === "skill_manage")
    return pending ? "Managing a skill" : "Used skill management";
  if (view.kind === "skill" && view.toolName === "skills_list")
    return pending ? "Listing skills" : "Listed skills";
  const target = toolTarget(view);
  if (target) {
    return view.kind === "skill"
      ? `${verb} the ${target} skill`
      : `${verb} ${target}`;
  }
  return `${verb} ${humanToolName(view.toolName)}`;
}

/**
 * A stored result whose body reports an error. Hermes history carries no
 * error flag, so a failed call would otherwise wear a check mark.
 */
export function outputReportsFailure(output: unknown) {
  if (typeof output !== "string") return false;
  const text = output.trim();
  if (!text.startsWith("{")) return false;
  try {
    const parsed = record(JSON.parse(text));
    return Boolean(parsed.error) || parsed.status === "error";
  } catch {
    return false;
  }
}
