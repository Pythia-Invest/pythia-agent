/** Paths in API JSON/query values are already decoded. Encode only at URL boundaries. */
export function workspaceUrl(path: string, heading?: string) {
  return `/workspace${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}${heading ? `#${encodeURIComponent(heading)}` : ""}`;
}
export function workspaceContentUrl(path: string, download = false) {
  return `/api/workspace/content?${new URLSearchParams({ path, ...(download ? { download: "true" } : {}) })}`;
}
/** Resolve Markdown links lexically; the server remains the containment authority. */
export function resolveWorkspaceLink(href: string, documentPath = "") {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//")) return null;
  const hash = href.indexOf("#");
  let path: string;
  let heading: string | undefined;
  try {
    path = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    heading = hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1));
  } catch {
    return null;
  }
  if (/[\\\0]/u.test(path)) return null;
  const parts = path.startsWith("/")
    ? []
    : documentPath.split("/").slice(0, -1);
  if (!path) return { path: documentPath, heading };
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return { path: parts.join("/"), heading };
}
