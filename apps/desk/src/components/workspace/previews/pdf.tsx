"use client";
import { usePreviewPosition } from "./position";
import type { WorkspaceEntry } from "@/workspace/types";
import { withPdfPage } from "@/workspace/previews/pdf-page";
import { usePreviewViewport } from "./viewport";
import { PreviewToolbar } from "./toolbar";
import { PreviewAction } from "./action";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  ScanText,
  Maximize2,
  Scan,
  RotateCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/** One page at a time keeps canvas memory bounded on long research reports.
 * PDF scripts, XFA and annotation actions are not executed. Assets stay local. */
export default function PdfPreview({
  url,
  entry,
  onReady,
}: {
  url: string;
  entry: WorkspaceEntry;
  onReady?: (() => void) | undefined;
}) {
  const [position, update] = usePreviewPosition(entry);
  const { page, rotation, fitPage, textView } = position;
  const zoom = position.zoom ?? 1;
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState(false);
  const [pageText, setPageText] = useState<string>();
  const [displayWidth, setDisplayWidth] = useState(600);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = usePreviewViewport(container);
  useEffect(() => {
    let active = true;
    let destroy: (() => void) | undefined;
    setDoc(undefined);
    setError(false);
    void import("pdfjs-dist")
      .then((pdf) => {
        if (!active) return;
        const port = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
          { type: "module" },
        );
        const worker = pdf.PDFWorker.create({ port });
        const task = pdf.getDocument({
          url,
          worker,
          cMapUrl: `/_pdfjs/${pdf.version}/cmaps/`,
          cMapPacked: true,
          enableXfa: false,
          useSystemFonts: true,
          disableAutoFetch: true,
          disableStream: true,
        });
        destroy = () => {
          void task.destroy();
          worker.destroy();
          port.terminate();
        };
        return task.promise.then((value) => {
          if (active) setDoc(value);
        });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      destroy?.();
    };
  }, [url]);
  useEffect(() => {
    if (!doc) return;
    let active = true;
    let cancel: (() => void) | undefined;
    void withPdfPage(doc, page, async (pdfPage) => {
      if (!active || !canvas.current) return;
      const angle = (pdfPage.rotate + rotation) % 360;
      const base = pdfPage.getViewport({ scale: 1, rotation: angle });
      const cssScale =
        Math.min(
          width / base.width,
          fitPage ? height / base.height : Infinity,
        ) * zoom;
      setDisplayWidth(base.width * cssScale);
      const scale = Math.min(
        cssScale * Math.min(devicePixelRatio, 2),
        4096 / Math.max(base.width, base.height),
      );
      const viewport = pdfPage.getViewport({ scale, rotation: angle });
      const element = canvas.current;
      element.width = Math.ceil(viewport.width);
      element.height = Math.ceil(viewport.height);
      const task = pdfPage.render({ canvas: element, viewport });
      cancel = () => task.cancel();
      await task.promise;
      if (active && !textView) onReady?.();
    }).catch((error) => {
      if (active && error?.name !== "RenderingCancelledException")
        setError(true);
    });
    return () => {
      active = false;
      cancel?.();
    };
  }, [doc, page, width, height, zoom, rotation, fitPage, textView, onReady]);
  useEffect(() => {
    let active = true;
    setPageText(undefined);
    if (doc && textView)
      void withPdfPage(doc, page, (p) => p.getTextContent())
        .then((content) => {
          if (active)
            setPageText(
              content.items
                .map((item) =>
                  "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
                )
                .join("")
                .slice(0, 100_000),
            );
        })
        .catch(() => {
          if (active) setPageText("Text is unavailable on this page.");
        });
    return () => {
      active = false;
    };
  }, [doc, page, textView]);
  useEffect(() => {
    if (error || (textView && pageText !== undefined)) onReady?.();
  }, [error, textView, pageText, onReady]);
  return (
    <div data-slot="workspace-pdf" ref={container} className="min-w-0">
      {error ? (
        <p role="status">
          This PDF could not be previewed. Download the original to open it.
        </p>
      ) : !doc ? (
        <p role="status">Loading PDF…</p>
      ) : null}
      {doc ? (
        <PreviewToolbar label="PDF tools">
          <div className="flex items-center gap-1">
            <PreviewAction
              size="sm"
              label="Previous page"
              disabled={page <= 1}
              onClick={() => update({ page: page - 1 })}
            >
              <ChevronLeft />
            </PreviewAction>
            <span className="flex items-center gap-1 tabular-nums">
              <input
                aria-label="Page number"
                type="number"
                min={1}
                max={doc.numPages}
                value={page}
                className="w-12 rounded-control bg-subtle px-1 py-1 text-center outline-ring focus-visible:outline-2"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (
                    Number.isInteger(next) &&
                    next >= 1 &&
                    next <= doc.numPages
                  )
                    update({ page: next });
                }}
              />
              / {doc.numPages}
              <span className="sr-only">
                {" "}
                · Page {page} of {doc.numPages}
              </span>
            </span>
            <PreviewAction
              size="sm"
              label="Next page"
              disabled={page >= doc.numPages}
              onClick={() => update({ page: page + 1 })}
            >
              <ChevronRight />
            </PreviewAction>
          </div>
          <div className="flex items-center gap-1 border-border border-l pl-2">
            <PreviewAction
              size="sm"
              label="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => update({ zoom: zoom - 0.25 })}
            >
              <Minus />
            </PreviewAction>
            <span className="w-9 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <PreviewAction
              size="sm"
              label="Zoom in"
              disabled={zoom >= 2}
              onClick={() => update({ zoom: zoom + 0.25 })}
            >
              <Plus />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Fit width"
              onClick={() => {
                update({ zoom: 1, fitPage: false });
              }}
            >
              <Maximize2 />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Fit page"
              onClick={() => {
                update({ zoom: 1, fitPage: true });
              }}
            >
              <Scan />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Rotate clockwise"
              onClick={() => update({ rotation: (rotation + 90) % 360 })}
            >
              <RotateCw />
            </PreviewAction>
          </div>
          <div className="ml-auto">
            <PreviewAction
              size="sm"
              label={textView ? "Page view" : "Text view"}
              onClick={() => update({ textView: !textView })}
            >
              <ScanText />
            </PreviewAction>
          </div>
        </PreviewToolbar>
      ) : null}
      {textView ? (
        <pre className="whitespace-pre-wrap break-words p-4 text-body">
          {pageText || "No selectable text on this page."}
        </pre>
      ) : null}
      <div className={textView ? "hidden" : "overflow-auto"}>
        <canvas
          ref={canvas}
          aria-label={`PDF page ${page}`}
          className="block"
          style={{ width: displayWidth }}
        />
      </div>
    </div>
  );
}
