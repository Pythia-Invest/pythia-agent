"use client";
import { useQuery } from "@tanstack/react-query";
import { useDeskApi } from "./providers";
import {
  OFFICE_BYTES,
  type ParsedKind,
  type ParseInput,
  type PreviewResult,
} from "@/workspace/previews/formats";
import type { WorkspaceEntry } from "@/workspace/types";

function parse(input: ParseInput, signal: AbortSignal) {
  return new Promise<PreviewResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const worker = new Worker(
      new URL("../workspace/previews/preview.worker.ts", import.meta.url),
    );
    const cleanup = () => {
      worker.terminate();
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Preview cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("This file is too complex to preview here."));
    }, 15_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ result?: PreviewResult; error?: string }>,
    ) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Preview unavailable."));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("Preview unavailable."));
    };
    worker.postMessage(input, [input.bytes]);
  });
}
export function useParsedPreview(entry: WorkspaceEntry, sheet: number) {
  const api = useDeskApi();
  return useQuery({
    queryKey: ["workspace", "preview", entry.path, entry.revision, sheet],
    queryFn: async ({ signal }) =>
      parse(
        {
          kind: entry.kind as ParsedKind,
          name: entry.name,
          sheet,
          bytes: await api.workspaceBytes(
            entry.path,
            entry.revision,
            OFFICE_BYTES,
            signal,
          ),
        },
        signal,
      ),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
