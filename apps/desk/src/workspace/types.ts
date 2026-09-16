export type WorkspaceKind =
  | "directory"
  | "markdown"
  | "text"
  | "image"
  | "pdf"
  | "csv"
  | "spreadsheet"
  | "document"
  | "notebook"
  | "audio"
  | "video"
  | "download";
export type WorkspaceEntry = {
  path: string;
  name: string;
  kind: WorkspaceKind;
  size: number;
  modified: string;
  revision: string;
  mediaType: string;
  previewable: boolean;
};
export type WorkspaceListing = {
  entries: WorkspaceEntry[];
  partial: boolean;
  scanned: number;
};
export type WorkspaceSearch = {
  total?: number;
  issues?: string[];
  matches: {
    entry: WorkspaceEntry;
    match: "name" | "path";
    nameRanges?: [number, number][];
    pathRanges?: [number, number][];
  }[];
  partial: boolean;
  scanned: number;
};
export const WORKSPACE_PREVIEW_BYTES = 2 * 1024 * 1024;
