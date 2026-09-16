import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceEntry } from "@/workspace/types";
import {
  readableStrategyBrief,
  strategyBriefPath,
  strategyName,
  strategyTitle,
} from "@/workspace/strategies";
import {
  StrategyBriefAction,
  StrategyChatContext,
} from "@/components/workspace/strategies/strategy-context";

const queries = vi.hoisted(() => ({
  entries: new Map<
    string,
    { data?: WorkspaceEntry; isPending: boolean; isError: boolean }
  >(),
  requestedEntries: [] as string[],
}));
vi.mock("@/client/queries", () => ({
  useWorkspaceEntry: (path: string) => {
    queries.requestedEntries.push(path);
    return queries.entries.get(path) ?? { isPending: false, isError: true };
  },
}));

// Same metadata projection as the real bounded Workspace file API. No market
// identity or strategy schema is required to recognize an ordinary Markdown file.
const entry = (
  path: string,
  kind: WorkspaceEntry["kind"] = "markdown",
): WorkspaceEntry => ({
  path,
  name: path.split("/").at(-1) ?? "Workspace",
  kind,
  size: 40,
  modified: "2026-01-01T00:00:00.000Z",
  revision: "synthetic-r1",
  mediaType: kind === "directory" ? "inode/directory" : "text/markdown",
  previewable: kind !== "directory",
});
const briefPath = "strategies/income/README.md";
const onOpen = vi.fn();
const onStartStrategy = vi.fn();
beforeEach(() => {
  queries.entries.clear();
  queries.requestedEntries.length = 0;
  onOpen.mockClear();
  onStartStrategy.mockClear();
});

it("recognizes only optional immediate strategy briefs and uses an available opening title", () => {
  expect(strategyBriefPath("strategies/income")).toBe(briefPath);
  expect(strategyBriefPath("research/income")).toBeNull();
  expect(strategyName("strategies/income/notes/README.md")).toBeNull();
  expect(strategyName("strategies/../README.md")).toBeNull();
  expect(
    strategyTitle(briefPath, "# Income research\n\nGoals are provisional."),
  ).toBe("Income research");
  expect(strategyTitle(briefPath, "No heading or metadata required.")).toBe(
    "income",
  );
  expect(
    readableStrategyBrief({ ...entry(briefPath), previewable: false }),
  ).toBe(false);
});

it("enables explicit strategy start for a readable brief without creating a session during browsing", () => {
  const html = renderToStaticMarkup(
    <StrategyBriefAction
      path={briefPath}
      entry={entry(briefPath)}
      text="# Income"
      onOpen={onOpen}
      onStartStrategy={onStartStrategy}
    />,
  );
  expect(html).toContain("Start chat for strategy");
  expect(html).not.toContain('disabled=""');
  expect(onStartStrategy).not.toHaveBeenCalled();
  const ordinary = renderToStaticMarkup(
    <StrategyBriefAction
      path="research/notes.md"
      entry={entry("research/notes.md")}
      text="# Notes"
      onOpen={onOpen}
      onStartStrategy={onStartStrategy}
    />,
  );
  expect(ordinary).toBe("");
});

it("uses native origin provenance and distinguishes a moved brief from general chat", () => {
  const context = {
    status: "ok" as const,
    guidance: "current" as const,
    firstInputEligible: false,
    scope: {
      status: "resolved" as const,
      reference: {
        version: 1 as const,
        originSessionId: "native-origin",
        briefPath,
      },
    },
  };
  const missing = renderToStaticMarkup(
    <StrategyChatContext context={context} onOpen={onOpen} />,
  );
  expect(missing).toContain("Started with");
  expect(missing).toContain('href="/workspace/strategies/income/README.md"');
  expect(missing).toContain(
    "Brief unavailable; the original reference is retained",
  );
  expect(onOpen).not.toHaveBeenCalled();
  const general = renderToStaticMarkup(
    <StrategyChatContext context={{ ...context, scope: { status: "none" } }} />,
  );
  expect(general).toBe("");
  const unresolved = renderToStaticMarkup(
    <StrategyChatContext
      context={{
        ...context,
        scope: { status: "unresolved", reason: "search_repair_pending" },
      }}
    />,
  );
  expect(unresolved).toContain("Strategy context could not be verified");
  expect(unresolved).not.toContain("Started with");
});
