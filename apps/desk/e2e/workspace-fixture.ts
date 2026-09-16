import type { Page } from "@playwright/test";
import type { WorkspaceEntry } from "../src/workspace/types";
import { fixture } from "./stream-fixture";

export async function returnToBrowser(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 900)
    await page.keyboard.press("Escape");
}

/** Synthetic browser fixtures only; the running Desk is supplied externally.
 * All research/API data is intercepted, so no native file or provider is used. */
export async function workspaceFixture(
  page: Page,
  content = "[Open synthetic research](research/notes.md#evidence)",
) {
  const chat = await fixture(page, [
    {
      id: "artifact-answer",
      role: "assistant",
      content,
    },
  ]);
  let version = 1;
  const reads: string[] = [];
  const entry = (path: string): WorkspaceEntry => ({
    path,
    name: path.split("/").at(-1) || "Workspace",
    kind: path.endsWith(".md") ? "markdown" : "directory",
    size: 10000,
    modified: "2026-01-01T00:00:00.000Z",
    revision: `version-${version}`,
    mediaType: "text/plain; charset=utf-8",
    previewable: path.endsWith(".md"),
  });
  await page.route("**/api/workspace/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get("path") ?? "";
    if (url.pathname.endsWith("/resolve")) {
      if (url.searchParams.get("hostPath") === "/synthetic/research/notes.md")
        return route.fulfill({ json: { path: "research/notes.md" } });
      return route.fulfill({
        status: 404,
        json: { error: { message: "File unavailable in Workspace." } },
      });
    }
    if (url.pathname.endsWith("/entry"))
      return route.fulfill({ json: entry(path) });
    if (url.pathname.endsWith("/list"))
      return route.fulfill({
        json: {
          entries:
            path === "" ? [entry("research")] : [entry("research/notes.md")],
          partial: false,
          scanned: 1,
        },
      });
    if (url.pathname.endsWith("/search"))
      return route.fulfill({
        json: {
          matches: [
            {
              entry: entry("research/comparison.md"),
              match: "name",
            },
          ],
          partial: true,
          scanned: 100,
        },
      });
    if (url.pathname.endsWith("/content")) {
      reads.push(`version-${version}`);
      const body =
        `# ${path === "research/comparison.md" ? "Synthetic risk comparison" : `Synthetic research version ${version}`}\n\n[Jump to evidence](#evidence)\n\n## Evidence\n\n![External](https://images.invalid/chart.png)\n\n` +
        Array.from(
          { length: 80 },
          (_, index) =>
            `Paragraph ${index}: synthetic observations for a scrolling fixture.\n\n`,
        ).join("");
      return route.fulfill({
        body,
        contentType: "text/plain; charset=utf-8",
        headers: {
          "x-workspace-revision": `version-${version}`,
          "content-length": String(new TextEncoder().encode(body).length),
          "content-disposition": "inline",
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { message: "Unknown synthetic workspace request" } },
    });
  });
  return {
    chat,
    reads,
    nextVersion: () => {
      version += 1;
    },
  };
}
