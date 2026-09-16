export const workspaceKeys = {
  all: ["workspace"] as const,
  entry: (path: string) => ["workspace", "entry", path] as const,
  list: (path: string) => ["workspace", "list", path] as const,
  text: (path: string, revision: string) =>
    ["workspace", "text", path, revision] as const,
  search: (path: string, q: string) =>
    ["workspace", "filename-search", path, q] as const,
};
