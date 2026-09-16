import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { WorkspaceEntry } from "@/workspace/types";
import { WorkspacePreview } from "@/components/workspace/workspace-preview";
import { WorkspaceSearchResults } from "@/components/workspace/workspace-search-results";

function entry(
  kind: WorkspaceEntry["kind"],
  path: string,
  previewable = true,
): WorkspaceEntry {
  return {
    path,
    kind,
    name: path.split("/").at(-1) ?? path,
    previewable,
    size: 32,
    modified: "2026-01-01T00:00:00.000Z",
    revision: "observed:1",
    mediaType: "application/octet-stream",
  };
}
const open = () => undefined;
it("previews raster through same-origin revision-pinned URLs", () => {
  const raster = renderToStaticMarkup(
    <WorkspacePreview
      entry={entry("image", "research/chart.png")}
      onOpen={open}
    />,
  );
  expect(raster).toContain(
    'src="/api/workspace/content?path=research%2Fchart.png&amp;revision=observed%3A1"',
  );
});
it("escapes display-only scripts and explains unavailable previews without duplicate actions", () => {
  const code = renderToStaticMarkup(
    <WorkspacePreview
      entry={entry("text", "models/test.py")}
      text={'<script>alert("never run")</script>'}
      onOpen={open}
    />,
  );
  expect(code).not.toContain("<script>");
  expect(code).toContain("&lt;script&gt;");
  for (const file of [
    entry("download", "inputs/book.xlsx", false),
    entry("markdown", "research/large.md", false),
  ]) {
    const html = renderToStaticMarkup(
      <WorkspacePreview entry={file} onOpen={open} />,
    );
    expect(html).toContain(
      file.kind === "markdown"
        ? "too large to preview"
        : "No preview available.",
    );
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<iframe");
  }
});
it("escapes filenames and reports actual incomplete scans", () => {
  const file = entry("markdown", "research/<not-html>.md");
  const html = renderToStaticMarkup(
    <WorkspaceSearchResults
      data={{
        matches: [
          {
            entry: file,
            match: "name",
          },
        ],
        partial: true,
        scanned: 1,
        issues: ["Some files could not be read."],
      }}
      query="[risk]"
      folder="research"
      onOpen={open}
      onOpenFile={open}
    />,
  );
  expect(html).toContain("&lt;not-html&gt;");
  expect(html).not.toContain("<not-html>");
  expect(html).toContain("Some files could not be read.");
  expect(html).toContain('href="/workspace/research/%3Cnot-html%3E.md"');
});
