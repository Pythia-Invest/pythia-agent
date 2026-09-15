import { isStrategyReference } from "./session-context";
import type { WorkspaceEntry } from "./types";

/** Optional folder convention only; these paths are not durable identities. */
export function strategyName(briefPath: string): string | null {
  return isStrategyReference({
    version: 1,
    originSessionId: "validation",
    briefPath,
  })
    ? (briefPath.split("/")[1] ?? null)
    : null;
}

export function strategyBriefPath(folder: string): string | null {
  const path = `${folder}/README.md`;
  return strategyName(path) ? path : null;
}

/** Use an opening H1 only when the reader already has the brief's text. */
export function strategyTitle(briefPath: string, text?: string): string {
  const firstLine = text?.trimStart().split(/\r?\n/u)[0] ?? "";
  const heading = /^#\s+(.+?)(?:\s+#+)?\s*$/u.exec(firstLine)?.[1]?.trim();
  return heading
    ? heading.slice(0, 120)
    : (strategyName(briefPath) ?? "Strategy");
}

export function readableStrategyBrief(
  entry: WorkspaceEntry | undefined,
): boolean {
  return Boolean(
    entry &&
      strategyName(entry.path) &&
      entry.kind === "markdown" &&
      entry.previewable &&
      entry.size > 0,
  );
}
