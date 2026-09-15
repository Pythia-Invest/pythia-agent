import { OFFICE_BYTES } from "@/workspace/previews/formats";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, sep, extname } from "node:path";
import { HermesApiError } from "../hermes-records";
import {
  WORKSPACE_PREVIEW_BYTES,
  type WorkspaceEntry,
} from "@/workspace/types";

// Transport receipts and implementation state are not investor research.
export const EXCLUDED = new Set([
  "attachments",
  ".git",
  ".pythia",
  ".private",
  "node_modules",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
]);
export function failure(code: string, message: string, status = 400) {
  return new HermesApiError(message, status, code);
}
export function cleanPath(path: string) {
  if (path.length > 4096 || /[\\\0\r\n]/u.test(path) || isAbsolute(path))
    throw failure("workspace_path", "Invalid workspace path.");
  if (
    path.length > 0 &&
    path
      .split("/")
      .some((p) => !p || p === "." || p === ".." || EXCLUDED.has(p))
  )
    throw failure("workspace_path", "This path is outside browsable research.");
  return path;
}
export function revision(s: Stats) {
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
}
export function fileBoundary(workspace: () => string | undefined) {
  async function root() {
    const configured = workspace();
    if (!configured || !isAbsolute(configured))
      throw failure(
        "workspace_unavailable",
        "The host workspace is not configured.",
        503,
      );
    try {
      return await realpath(configured);
    } catch {
      throw failure(
        "workspace_unavailable",
        "The host workspace is unavailable.",
        503,
      );
    }
  }
  async function inspect(path: string) {
    cleanPath(path);
    const base = await root();
    let target = base;
    let stat = await lstat(base);
    for (const part of path ? path.split("/") : []) {
      target = join(target, part);
      stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw failure(
          "workspace_path",
          "Symbolic links are not browsable.",
          403,
        );
    }
    if (!stat.isDirectory() && !stat.isFile())
      throw failure(
        "workspace_type",
        "Only regular files and directories are browsable.",
        415,
      );
    return { target, stat, base };
  }
  async function checked(path: string, handle: FileHandle, initial: Stats) {
    const now = await inspect(path);
    if (
      revision(await handle.stat()) !== revision(initial) ||
      revision(now.stat) !== revision(initial)
    )
      throw failure(
        "workspace_changed",
        "The file changed while being read. Reopen it.",
        409,
      );
  }
  async function file(path: string) {
    const before = await inspect(path);
    if (!before.stat.isFile())
      throw failure("workspace_type", "Choose a regular file.", 415);
    const handle = await open(
      before.target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      await checked(path, handle, before.stat);
    } catch (error) {
      await handle.close();
      throw error;
    }
    return {
      ...before,
      handle,
      check: () => checked(path, handle, before.stat),
    };
  }
  async function hostPath(path: string) {
    const base = await root();
    const local = relative(base, path);
    if (
      !isAbsolute(path) ||
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      isAbsolute(local)
    )
      throw failure(
        "workspace_path",
        "The file is outside this workspace.",
        403,
      );
    const normalized = local.split(sep).join("/");
    await inspect(normalized);
    return normalized;
  }
  return { root, inspect, file, hostPath };
}
export async function describe(
  path: string,
  stat: Stats,
  handle?: FileHandle,
): Promise<WorkspaceEntry> {
  if (!handle) return describeBytes(path, stat);
  const prefix = Buffer.alloc(Math.min(stat.size, 8192));
  await handle.read(prefix, 0, prefix.length, 0);
  return describeBytes(path, stat, prefix);
}
export function textPath(path: string) {
  return /^\.(md|markdown|txt|csv|tsv|py|js|ts|tsx|jsx|json|yaml|yml|toml|sh|css|sql|r|rs|go|java|c|h|cpp|log)$/u.test(
    extname(path).toLowerCase(),
  );
}
export function describeBytes(
  path: string,
  stat: Stats,
  prefix?: Buffer,
): WorkspaceEntry {
  const entry: WorkspaceEntry = {
    path,
    name: path.split("/").at(-1) || "Workspace",
    size: stat.size,
    modified: stat.mtime.toISOString(),
    revision: revision(stat),
    kind: stat.isDirectory() ? "directory" : "download",
    mediaType: "application/octet-stream",
    previewable: false,
  };
  if (!prefix) return entry;
  const ext = extname(path).toLowerCase();
  if (
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    entry.kind = "image";
    entry.mediaType = "image/png";
  } else if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) {
    entry.kind = "image";
    entry.mediaType = "image/jpeg";
  } else if (["GIF87a", "GIF89a"].includes(prefix.subarray(0, 6).toString())) {
    entry.kind = "image";
    entry.mediaType = "image/gif";
  } else if (
    prefix.subarray(0, 4).toString() === "RIFF" &&
    prefix.subarray(8, 12).toString() === "WEBP"
  ) {
    entry.kind = "image";
    entry.mediaType = "image/webp";
  } else if (prefix.subarray(0, 5).toString() === "%PDF-") {
    entry.kind = "pdf";
    entry.mediaType = "application/pdf";
  } else if (!prefix.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(prefix, {
        stream: stat.size > prefix.length,
      });
      entry.kind = /^(\.md|\.markdown)$/u.test(ext) ? "markdown" : "text";
      entry.mediaType = "text/plain; charset=utf-8";
    } catch {
      /* Binary stays download-only. */
    }
  }
  const zip = prefix[0] === 80 && prefix[1] === 75;
  const compound = prefix
    .subarray(0, 8)
    .equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  if (zip && ext === ".docx") {
    entry.kind = "document";
    entry.mediaType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (
    (zip && [".xlsx", ".xlsm", ".xlsb", ".ods"].includes(ext)) ||
    (compound && ext === ".xls")
  ) {
    entry.kind = "spreadsheet";
    entry.mediaType = "application/octet-stream";
  } else if (entry.kind === "text" && [".csv", ".tsv"].includes(ext)) {
    entry.kind = "csv";
  } else if (entry.kind === "text" && ext === ".ipynb") {
    entry.kind = "notebook";
  } else if (prefix.subarray(0, 2).toString() === "BM") {
    entry.kind = "image";
    entry.mediaType = "image/bmp";
  } else if (prefix.subarray(4, 12).toString() === "ftypavif") {
    entry.kind = "image";
    entry.mediaType = "image/avif";
  } else if (prefix.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) {
    entry.kind = "image";
    entry.mediaType = "image/x-icon";
  } else if (
    prefix.subarray(0, 4).toString() === "RIFF" &&
    prefix.subarray(8, 12).toString() === "WAVE"
  ) {
    entry.kind = "audio";
    entry.mediaType = "audio/wav";
  } else if (
    ext === ".mp3" &&
    (prefix.subarray(0, 3).toString() === "ID3" ||
      (prefix[0] === 255 && ((prefix[1] ?? 0) & 224) === 224))
  ) {
    entry.kind = "audio";
    entry.mediaType = "audio/mpeg";
  } else if (
    [".mp4", ".m4a"].includes(ext) &&
    prefix.subarray(4, 8).toString() === "ftyp"
  ) {
    entry.kind = ext === ".m4a" ? "audio" : "video";
    entry.mediaType = ext === ".m4a" ? "audio/mp4" : "video/mp4";
  } else if (
    ext === ".webm" &&
    prefix.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
  ) {
    entry.kind = "video";
    entry.mediaType = "video/webm";
  }
  entry.previewable =
    ["image", "pdf", "audio", "video"].includes(entry.kind) ||
    (["spreadsheet", "document", "csv", "notebook"].includes(entry.kind) &&
      stat.size <= OFFICE_BYTES) ||
    (["text", "markdown"].includes(entry.kind) &&
      stat.size <= WORKSPACE_PREVIEW_BYTES);
  return entry;
}
