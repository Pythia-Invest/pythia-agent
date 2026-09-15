import { afterEach, expect, it, vi } from "vitest";
import { hydrate, QueryClient } from "@tanstack/react-query";
import { initialWorkspaceState } from "@/server/workspace/initial";
import { workspaceKeys } from "@/workspace/query-keys";
import type { WorkspaceEntry } from "@/workspace/types";

const entry: WorkspaceEntry = {
  path: "research",
  name: "research",
  kind: "directory",
  size: 0,
  modified: "2026-01-01",
  revision: "1",
  mediaType: "application/octet-stream",
  previewable: false,
};
function store(value = entry) {
  return {
    entry: vi.fn(async () => value),
    list: vi.fn(async () => ({ entries: [entry], partial: false, scanned: 1 })),
  };
}
function request(overrides: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:43121/workspace", {
    headers: {
      host: "127.0.0.1:43121",
      "sec-fetch-site": "none",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      ...overrides,
    },
  });
}
afterEach(() => vi.unstubAllEnvs());

it("hydrates the entry and folder into the existing query keys", async () => {
  const files = store();
  const state = await initialWorkspaceState(request(), "research", files);
  const cache = new QueryClient();
  if (!state) throw new Error("Expected admitted snapshot");
  hydrate(cache, state);
  expect(cache.getQueryData(workspaceKeys.entry("research"))).toEqual(entry);
  expect(cache.getQueryData(workspaceKeys.list("research"))).toEqual(
    await files.list.mock.results[0]?.value,
  );
  expect(files.list).toHaveBeenCalledWith("research", expect.any(AbortSignal));
});

it("lists the parent for a direct file URL without reading its contents", async () => {
  const files = store({ ...entry, path: "research/note.md", kind: "markdown" });
  await initialWorkspaceState(request(), "research/note.md", files);
  expect(files.list).toHaveBeenCalledWith("research", expect.any(AbortSignal));
});

it.each([
  { host: "attacker.example" },
  { origin: "https://attacker.example" },
  { "sec-fetch-site": "cross-site" },
  { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
])("does not read files for untrusted page requests: %j", async (headers) => {
  const files = store();
  expect(await initialWorkspaceState(request(headers), "", files)).toBeNull();
  expect(files.entry).not.toHaveBeenCalled();
});

it("enforces the configured Serve identity for initial HTML", async () => {
  vi.stubEnv(
    "PYTHIA_DESK_TAILSCALE_ORIGIN",
    "https://desk.example.ts.net:9443",
  );
  vi.stubEnv("PYTHIA_DESK_TAILSCALE_LOGIN", "investor@example.com");
  const headers = {
    host: "desk.example.ts.net:9443",
    "x-forwarded-host": "desk.example.ts.net:9443",
    "x-forwarded-proto": "https",
    "tailscale-user-login": "wrong@example.com",
  };
  const files = store();
  expect(await initialWorkspaceState(request(headers), "", files)).toBeNull();
  expect(files.entry).not.toHaveBeenCalled();
  headers["tailscale-user-login"] = "investor@example.com";
  expect(
    await initialWorkspaceState(request(headers), "", files),
  ).not.toBeNull();
});

it("keeps successful metadata when listing fails, and isolates subsequent requests", async () => {
  const files = store();
  files.list.mockRejectedValueOnce(new Error("private host path"));
  const first = await initialWorkspaceState(request(), "research", files);
  expect(first?.queries).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain("private host path");
  files.entry.mockRejectedValueOnce(new Error("missing"));
  const second = await initialWorkspaceState(request(), "missing", files);
  expect(second?.queries).toEqual([]);
});

it("accepts same-origin RSC navigation through the same page admission", async () => {
  const files = store();
  expect(
    await initialWorkspaceState(
      request({
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      }),
      "research",
      files,
    ),
  ).not.toBeNull();
  expect(files.entry).toHaveBeenCalledWith("research");
});
