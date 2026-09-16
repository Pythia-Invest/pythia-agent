import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { nativePathLocator } from "@/components/workspace/workspace-link";
import { WorkspaceMarkdown } from "@/components/workspace/workspace-markdown";
import { createWorkspaceStore } from "@/server/workspace/store";
import { createWorkspaceRoutes } from "@/server/workspace/routes";

it("reads a synthetic producer's ordinary Markdown through admitted file serving into the reader", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pythia-reader-")));
  try {
    await mkdir(join(root, "research"));
    await writeFile(
      join(root, "research", "example.md"),
      "# Synthetic research\n\n[Evidence](./evidence.md#source)\n\nThis fixture is not investment advice or provider data.\n",
    );
    await writeFile(join(root, "research", "café notes.md"), "# Risk settings");
    const store = createWorkspaceStore(() => root);
    const nativeHref = `file://${root}/research/caf%C3%A9%20notes.md#risk-settings`;
    const native = nativePathLocator(nativeHref);
    expect(native).not.toBeNull();
    if (!native) throw new Error("Expected valid native locator");
    expect(await store.resolveHostPath(native.hostPath)).toBe(
      "research/café notes.md",
    );
    expect(native.heading).toBe("risk-settings");
    const routes = createWorkspaceRoutes(store);
    const request = new Request(
      "http://localhost:43121/api/workspace/content?path=research%2Fexample.md",
      {
        headers: { host: "localhost:43121", origin: "http://localhost:43121" },
      },
    );
    const response = await routes.workspaceContent(request);
    expect(response.status).toBe(200);
    const entry = await store.entry("research/example.md");
    expect(response.headers.get("x-workspace-revision")).toBe(entry.revision);
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown path={entry.path} text={await response.text()} />,
    );
    expect(html).toContain('id="synthetic-research"');
    expect(html).toContain('href="/workspace/research/evidence.md#source"');
    expect((await store.reference(entry.path)).hostPath).toBe(
      join(root, "research", "example.md"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
