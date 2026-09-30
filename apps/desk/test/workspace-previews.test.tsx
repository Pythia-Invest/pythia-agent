// @vitest-environment jsdom
// DOMPurify needs a DOM; the document preview sanitizes before injecting HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { WorkspaceEntry } from "@/workspace/types";
import { WorkspacePreview } from "@/components/workspace/workspace-preview";
import { DocumentPreview } from "@/components/workspace/previews/document";
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
it("shows the store's incomplete-scan issues", () => {
  const file = entry("markdown", "research/notes.md");
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
  expect(html).toContain("Some files could not be read.");
});
it("strips scripts, event handlers, unsafe links and remote images from converted documents", () => {
  const html = renderToStaticMarkup(
    <DocumentPreview
      html={
        '<p onclick="steal()">Memo<script>steal()</script></p>' +
        '<a href="javascript:steal()">Run</a>' +
        '<a href="https://example.com/source">Source</a>' +
        '<img src="https://tracker.example/pixel.png">' +
        '<iframe src="https://bad.example"></iframe>'
      }
    />,
  );
  expect(html).toContain("Memo");
  expect(html).toContain('href="https://example.com/source"');
  expect(html).not.toMatch(
    /<script|<iframe|onclick|javascript:|tracker\.example/i,
  );
});
