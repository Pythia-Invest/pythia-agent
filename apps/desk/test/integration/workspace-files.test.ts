import {
  mkdtemp,
  mkdir,
  writeFile,
  realpath,
  rm,
  symlink,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as filesystem from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkspaceStore } from "@/server/workspace/store";
import { createWorkspaceRoutes } from "@/server/workspace/routes";
import { resolveWorkspaceLink, workspaceUrl } from "@/workspace/paths";
// Keep real disk operations, with replaceable entry points for deterministic races.
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
}));
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "pythia-workspace-")),
  );
  roots.push(root);
  const store = createWorkspaceStore(() => root);
  return { root, store, routes: createWorkspaceRoutes(store) };
}
function request(path: string, extra: RequestInit = {}) {
  return new Request(
    `http://localhost:43121/api/workspace/content?path=${encodeURIComponent(path)}`,
    {
      ...extra,
      headers: {
        host: "localhost:43121",
        origin: "http://localhost:43121",
        ...extra.headers,
      },
    },
  );
}
it("browses ordinary files, searches names, resolves host references and retains attachment exclusions", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "Research"));
  await writeFile(
    join(root, "Research", "café notes.md"),
    "# Notes\nLiteral [risk].\n",
  );
  await mkdir(join(root, "attachments"));
  await writeFile(join(root, "attachments", "hidden.md"), "risk");
  expect((await store.list("")).entries.map((e) => e.name)).toEqual([
    "Research",
  ]);
  expect((await store.search("", "[risk]")).matches).toEqual([]);
  expect((await store.search("", "café ntoes")).matches[0]?.entry.path).toBe(
    "Research/café notes.md",
  );
  expect((await store.search("", "does not exist")).matches).toEqual([]);
  expect(
    await store.resolveHostPath(join(root, "Research", "café notes.md")),
  ).toBe("Research/café notes.md");
  expect((await store.reference("Research/café notes.md")).hostPath).toBe(
    join(root, "Research", "café notes.md"),
  );
  expect(
    resolveWorkspaceLink(
      "../Research/caf%C3%A9%20notes.md#notes",
      "Research/other.md",
    ),
  ).toEqual({ path: "Research/café notes.md", heading: "notes" });
  expect(workspaceUrl("Research/café notes.md", "notes")).toBe(
    "/workspace/Research/caf%C3%A9%20notes.md#notes",
  );
});
it("enforces admission, decoded containment and no symlinks", async () => {
  const { root, store, routes } = await fixture();
  await writeFile(join(root, "safe.txt"), "safe");
  await symlink(join(root, "safe.txt"), join(root, "link.txt"));
  await symlink(root, join(root, "linked-dir"));
  expect(
    (
      await routes.workspaceContent(
        request("safe.txt", { headers: { origin: "https://foreign.example" } }),
      )
    ).status,
  ).toBe(403);
  for (const path of [
    "../outside",
    "attachments/x",
    "link.txt",
    "linked-dir/safe.txt",
    "/etc/passwd",
    "a\\b",
  ])
    await expect(store.entry(path)).rejects.toBeDefined();
  expect(
    (
      await routes.workspaceContent(
        new Request(
          "http://localhost:43121/api/workspace/content?path=%2e%2e%2foutside",
          {
            headers: {
              host: "localhost:43121",
              origin: "http://localhost:43121",
            },
          },
        ),
      )
    ).status,
  ).toBe(400);
  expect((await routes.workspaceEntry(request("gone"))).status).toBe(404);
  await expect(
    createWorkspaceStore(() => undefined).list(""),
  ).rejects.toMatchObject({ status: 503 });
});
it("serves accurate bounded ranges, safe downloads and rejects changed streams", async () => {
  const { root, store, routes } = await fixture();
  await writeFile(join(root, "paper.pdf"), "%PDF-1.7\nsynthetic");
  const pdf = await routes.workspaceContent(
    request("paper.pdf", { headers: { range: "bytes=0-4" } }),
  );
  expect(pdf.status).toBe(206);
  expect(pdf.headers.get("content-security-policy")).toBe(
    "default-src 'none'; sandbox; frame-ancestors 'self'",
  );
  expect(pdf.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(await pdf.text()).toBe("%PDF-");
  expect(pdf.headers.get("content-range")).toBe("bytes 0-4/18");
  expect(pdf.headers.get("cache-control")).toBe("no-store");
  expect(
    (
      await routes.workspaceContent(
        request("paper.pdf", { headers: { range: "bytes=900-" } }),
      )
    ).status,
  ).toBe(416);
  for (const name of ["active.html", "active.svg", "fake.png"]) {
    await writeFile(join(root, name), "<script>alert(1)</script>");
    const response = await store.response(name, request(name));
    expect(response.headers.get("content-disposition")).toContain("inline;");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await response.body?.cancel();
  }
  const original = request("paper.pdf");
  const downloadUrl = new URL(original.url);
  downloadUrl.searchParams.set("download", "true");
  const downloadedPdf = await store.response(
    "paper.pdf",
    new Request(downloadUrl, original),
  );
  expect(downloadedPdf.headers.get("x-frame-options")).toBe("DENY");
  expect(downloadedPdf.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  await downloadedPdf.body?.cancel();
  await writeFile(join(root, "large.txt"), Buffer.alloc(3 * 1024 * 1024, 65));
  expect((await store.entry("large.txt")).previewable).toBe(false);
  expect((await store.search("", "absent")).partial).toBe(false);
  const response = await store.response("large.txt", request("large.txt"));
  if (!response.body) throw new Error("Expected a file stream");
  const reader = response.body.getReader();
  await reader.read();
  await rename(join(root, "large.txt"), join(root, "old.txt"));
  await symlink(join(root, "old.txt"), join(root, "large.txt"));
  // A validated chunk may already be queued by the native stream's one-chunk
  // prefetch. The next pull must reject the replaced path, not finish the file.
  await expect(
    (async () => {
      await reader.read();
      await reader.read();
    })(),
  ).rejects.toBeDefined();
});
it("bounds enumeration and cancels search and downloads", async () => {
  const { root, store } = await fixture();
  await Promise.all(
    Array.from({ length: 1002 }, (_, i) =>
      writeFile(join(root, `${i}.txt`), "small"),
    ),
  );
  expect((await store.list("")).partial).toBe(true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    store.search("", "small", controller.signal),
  ).rejects.toBeDefined();
  await expect(
    store.response("0.txt", request("0.txt", { signal: controller.signal })),
  ).rejects.toBeDefined();
});

it("preserves search matches when a listed file and queued directory disappear", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "queued"));
  await writeFile(join(root, "a-match.txt"), "kept");
  await writeFile(join(root, "b-match.txt"), "match");
  const originalStat = filesystem.lstat;
  let targetOpens = 0;
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    if (args[0] === join(root, "b-match.txt") && ++targetOpens === 1) {
      await rm(join(root, "b-match.txt"));
    }
    return originalStat(...args);
  });
  const originalOpendir = filesystem.opendir;
  vi.spyOn(filesystem, "opendir").mockImplementation(async (...args) => {
    if (args[0] === join(root, "queued"))
      await rm(join(root, "queued"), { recursive: true });
    return originalOpendir(...args);
  });
  const result = await store.search("", "match");
  expect(result.matches.map((match) => match.entry.path)).toEqual([
    "a-match.txt",
  ]);
  expect(result.partial).toBe(true);
  await expect(store.search("missing-root", "match")).rejects.toBeDefined();
});
it("propagates cancellation during result validation", async () => {
  const { root, store } = await fixture();
  await writeFile(join(root, "note.txt"), "match");
  const original = filesystem.lstat;
  vi.spyOn(filesystem, "lstat").mockImplementation(async (...args) => {
    if (args[0] === join(root, "note.txt"))
      throw new DOMException("Cancelled", "AbortError");
    return original(...args);
  });
  await expect(store.search("", "note")).rejects.toMatchObject({
    name: "AbortError",
  });
});

it("pins preview ranges to the observed revision and permits explicit latest reads", async () => {
  const { root, store, routes } = await fixture();
  await writeFile(join(root, "paper.pdf"), "%PDF-1.7\noriginal");
  const entry = await store.entry("paper.pdf");
  function preview(revision: string) {
    const original = request("paper.pdf", { headers: { range: "bytes=0-4" } });
    const url = new URL(original.url);
    url.searchParams.set("revision", revision);
    return new Request(url, original);
  }
  const first = await routes.workspaceContent(preview(entry.revision));
  expect(first.status).toBe(206);
  expect(await first.text()).toBe("%PDF-");
  await writeFile(join(root, "replacement.pdf"), "%PDF-1.7\nreplacement");
  await rename(join(root, "replacement.pdf"), join(root, "paper.pdf"));
  const stale = await routes.workspaceContent(preview(entry.revision));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    error: { code: "workspace_changed" },
  });
  expect((await routes.workspaceContent(preview("x".repeat(257)))).status).toBe(
    409,
  );
  const latest = await routes.workspaceContent(request("paper.pdf"));
  expect(latest.status).toBe(200);
  expect(await latest.text()).toBe("%PDF-1.7\nreplacement");
});

it("ranks deep exact names before more than 100 partial filename matches", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "Research"));
  await Promise.all(
    Array.from({ length: 105 }, (_, i) =>
      writeFile(join(root, `valuation-note-${i}.txt`), "valuation evidence"),
    ),
  );
  await writeFile(
    join(root, "Research", "valuation.md"),
    "# Valuation\nFictional valuation evidence",
  );
  const result = await store.search("", "valuation");
  expect(result.matches[0]?.entry.path).toBe("Research/valuation.md");
  expect(result.matches[0]?.match).toBe("name");
  expect(result.total).toBe(106);
  expect(result.matches).toHaveLength(100);
  expect(result.partial).toBe(true);
});

it("finds every file format by name without opening even a large file", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "Aurora"));
  await writeFile(
    join(root, "Aurora", "scenario-assumptions.md"),
    "Fictional research only.",
  );
  await writeFile(
    join(root, "operating-margin.csv"),
    "metric,value\nbody-only-marker,24",
  );
  await writeFile(join(root, "margin-chart.png"), Buffer.from([0, 1, 2]));
  const large = await filesystem.open(join(root, "margin-report.pdf"), "w");
  try {
    await large.truncate(512 * 1024 * 1024);
  } finally {
    await large.close();
  }
  const opened = vi.spyOn(filesystem, "open");
  expect((await store.search("", "aur assumptinos")).matches[0]?.match).toBe(
    "path",
  );
  expect((await store.search("", '"scenario assumptions"')).matches).toEqual(
    [],
  );
  const result = await store.search("", "margin");
  expect(result.matches.map((match) => match.entry.path)).toEqual([
    "margin-chart.png",
    "margin-report.pdf",
    "operating-margin.csv",
  ]);
  expect(result.partial).toBe(false);
  expect((await store.search("", "body-only-marker")).matches).toEqual([]);
  expect(opened).not.toHaveBeenCalled();
});

it("does not read file bodies for irrelevant names and avoids ancestor-only floods", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "Aurora"));
  await writeFile(join(root, "Aurora", "assumptions.md"), "fictional pricing");
  await writeFile(join(root, "Aurora", "unrelated.txt"), "fictional text");
  const opened = vi.spyOn(filesystem, "open");
  expect((await store.list("Aurora")).entries).toHaveLength(2);
  expect(opened).not.toHaveBeenCalled();
  const folders = await store.search("", "aurora");
  expect(folders.matches.map((m) => m.entry.path)).toEqual(["Aurora"]);
  expect(opened).not.toHaveBeenCalled();
  const mixed = await store.search("", "aurora assumptions");
  expect(mixed.matches.map((m) => m.entry.path)).toEqual([
    "Aurora/assumptions.md",
  ]);
  expect(mixed.matches[0]?.match).toBe("path");
  expect(opened).not.toHaveBeenCalled();
});
it("searches beyond the browser listing cap without opening every candidate", async () => {
  const { root, store } = await fixture();
  await Promise.all(
    Array.from({ length: 1100 }, (_, i) =>
      writeFile(join(root, `note-${i}.txt`), "fictional content"),
    ),
  );
  await writeFile(join(root, "zz-exact-target.md"), "fictional target");
  const opened = vi.spyOn(filesystem, "open");
  const result = await store.search("", "zz-exact-target");
  expect(result.matches[0]?.entry.path).toBe("zz-exact-target.md");
  expect(result.partial).toBe(false);
  expect(result.scanned).toBe(1101);
  expect(opened).not.toHaveBeenCalled();
});
it("finishes filename search even when traversal exceeds the old time limit", async () => {
  const { root, store } = await fixture();
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested", "notes.md"), "fictional");
  vi.useFakeTimers({ toFake: ["Date"] });
  const original = filesystem.opendir;
  vi.spyOn(filesystem, "opendir").mockImplementation(async (...args) => {
    const directory = await original(...args);
    vi.setSystemTime(Date.now() + 60_000);
    return directory;
  });
  try {
    const result = await store.search("", "notes");
    expect(result.matches).toHaveLength(1);
    expect(result.partial).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
it("honors cancellation during directory enumeration", async () => {
  const { root, store } = await fixture();
  await writeFile(join(root, "note.txt"), "fictional content");
  const controller = new AbortController();
  const original = filesystem.opendir;
  vi.spyOn(filesystem, "opendir").mockImplementation(async (...args) => {
    const directory = await original(...args);
    controller.abort();
    return directory;
  });
  await expect(
    store.search("", "note", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
