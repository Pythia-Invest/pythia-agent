import {
  isStrategyReference,
  NATIVE_SESSION_ID,
  type StrategyReference,
  parseStrategyScopeNotes,
} from "./session-context";
import type { DeskView } from "@/view-context/types";
import type { RunStart } from "@/server/types";
export type FileReference = {
  path: string;
  heading?: string;
  selection?: string;
  revision?: string;
};
export type WorkspaceContext = {
  references: FileReference[];
  strategy?: StrategyReference;
  startStrategyPath?: string;
  previousSessionId?: string;
};
export type WorkspaceTurn = {
  context?: WorkspaceContext;
  view?: { tab_id: string; view: DeskView };
};
export type DeskRunStart = RunStart & {
  desk_view?: { view_reference: string; expires_at: number };
};
export const REFERENCE_MARKER = "[PYTHIA_WORKSPACE_REFERENCES_V1]";
export const VIEW_MARKER = "[PYTHIA_DESK_VIEW_V1]";
export const MAX_REFERENCES = 10;
function bounded(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" && value.length <= limit && !value.includes("\0")
  );
}
export function parseFileReference(value: unknown): FileReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const file = value as Record<string, unknown>;
  if (
    !bounded(file.path, 2048) ||
    !file.path ||
    file.path.startsWith("/") ||
    file.path.includes("\\") ||
    file.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  const result: FileReference = { path: file.path };
  for (const [key, maximum] of [
    ["heading", 256],
    ["selection", 4000],
    ["revision", 200],
  ] as const) {
    if (file[key] !== undefined) {
      if (!bounded(file[key], maximum)) return null;
      result[key] = file[key];
    }
  }
  return result;
}
export function parseWorkspaceContext(value: unknown): WorkspaceContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.references) ||
    record.references.length > MAX_REFERENCES
  )
    return null;
  const references = record.references.map(parseFileReference);
  if (references.some((reference) => !reference)) return null;
  const context: WorkspaceContext = {
    references: references as FileReference[],
  };
  if (record.strategy !== undefined) {
    if (!isStrategyReference(record.strategy)) return null;
    context.strategy = record.strategy;
  }
  if (record.startStrategyPath !== undefined) {
    if (
      !bounded(record.startStrategyPath, 1024) ||
      !isStrategyReference({
        version: 1,
        originSessionId: "validation",
        briefPath: record.startStrategyPath,
      })
    )
      return null;
    context.startStrategyPath = record.startStrategyPath;
  }
  if (record.previousSessionId !== undefined) {
    if (
      typeof record.previousSessionId !== "string" ||
      !NATIVE_SESSION_ID.test(record.previousSessionId)
    )
      return null;
    context.previousSessionId = record.previousSessionId;
  }
  return context;
}
export function hasWorkspaceContext(context: WorkspaceContext | undefined) {
  return (
    !!context &&
    !!(
      context.references.length ||
      context.strategy ||
      context.startStrategyPath ||
      context.previousSessionId
    )
  );
}
/** Recover display references from ordinary persisted native text. Unknown or
 * malformed notes stay visible; their presence never grants server authority. */
export function splitWorkspaceNotes(text: string): {
  text: string;
  context: WorkspaceContext;
} {
  let context: WorkspaceContext = { references: [] };
  const lines = text.split(/\r?\n/u).filter((line) => {
    if (line.startsWith(`${REFERENCE_MARKER} `)) {
      try {
        const parsed = parseWorkspaceContext(
          JSON.parse(line.slice(REFERENCE_MARKER.length + 1)),
        );
        if (!parsed || parsed.startStrategyPath) return true;
        context = { ...context, ...parsed };
        return false;
      } catch {
        return true;
      }
    }
    const scope = parseStrategyScopeNotes(line)[0];
    if (scope) {
      context.strategy = scope;
      return false;
    }
    if (line.startsWith(`${VIEW_MARKER} `)) {
      try {
        const view = JSON.parse(line.slice(VIEW_MARKER.length + 1));
        if (
          view &&
          typeof view.view_reference === "string" &&
          /^[A-Za-z0-9_-]{43}$/u.test(view.view_reference)
        )
          return false;
      } catch {
        /* Preserve malformed text. */
      }
    }
    return true;
  });
  return { text: lines.join("\n").trimEnd(), context };
}
