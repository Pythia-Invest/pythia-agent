import { codeLanguage } from "@/workspace/previews/formats";
import { cn } from "@pythia/ui";
import {
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  NotebookPen,
} from "lucide-react";
import type { WorkspaceEntry } from "@/workspace/types";

/** Presentation only: icons never determine whether a file may be previewed. */
export function WorkspaceFileIcon({
  entry,
  expanded = false,
  className,
}: {
  entry: Pick<WorkspaceEntry, "name"> & { kind?: WorkspaceEntry["kind"] };
  expanded?: boolean;
  className?: string;
}) {
  const extension = entry.name.split(".").at(-1)?.toLowerCase() ?? "";
  const Icon =
    entry.kind === "directory"
      ? expanded
        ? FolderOpen
        : Folder
      : entry.kind === "markdown" || /^(md|markdown|mdx)$/.test(extension)
        ? NotebookPen
        : entry.kind === "image" ||
            /^(png|jpe?g|gif|webp|bmp|avif)$/.test(extension)
          ? FileImage
          : entry.kind === "pdf" || extension === "pdf"
            ? FileType2
            : entry.kind === "spreadsheet" ||
                entry.kind === "csv" ||
                /^(csv|tsv|xlsx?|xlsm|xlsb|ods|parquet)$/.test(extension)
              ? FileSpreadsheet
              : /^(json|jsonl|ya?ml|toml)$/.test(extension)
                ? FileJson2
                : codeLanguage(entry.name) !== "text" ||
                    /^(ipynb)$/.test(extension)
                  ? FileCode2
                  : /^(zip|gz|tar|7z|rar)$/.test(extension)
                    ? FileArchive
                    : ["text", "document"].includes(entry.kind ?? "") ||
                        extension === "docx"
                      ? FileText
                      : File;
  return (
    <Icon
      aria-hidden="true"
      data-slot="workspace-file-icon"
      className={cn(
        "size-4 shrink-0 stroke-[1.5] text-foreground-secondary",
        entry.kind === "directory"
          ? "text-artifact-folder"
          : Icon === FileSpreadsheet || Icon === FileJson2 || Icon === FileCode2
            ? "text-artifact-data"
            : Icon === NotebookPen || Icon === FileImage || Icon === FileType2
              ? "text-artifact-document"
              : undefined,
        className,
      )}
    />
  );
}
