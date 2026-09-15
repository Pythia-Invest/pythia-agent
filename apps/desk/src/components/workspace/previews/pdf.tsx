"use client";
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
export default function PdfPreview({ url }: { url: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy>();
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [textView, setTextView] = useState(false);
  const [pageText, setPageText] = useState("");
  const [rotation, setRotation] = useState(0);
  const [fitPage, setFitPage] = useState(false);
  const [displayWidth, setDisplayWidth] = useState(600);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = usePreviewViewport(container);
  useEffect(() => {
    let active = true;
    let destroy: (() => void) | undefined;
    setDoc(undefined);
    setError(false);
    setPage(1);
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
    void doc
      .getPage(page)
      .then((pdfPage) => {
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
        return task.promise;
      })
      .catch((error) => {
        if (active && error?.name !== "RenderingCancelledException")
          setError(true);
      });
    return () => {
      active = false;
      cancel?.();
    };
  }, [doc, page, width, height, zoom, rotation, fitPage]);
  useEffect(() => {
    let active = true;
    setPageText("");
    if (doc && textView)
      void doc
        .getPage(page)
        .then((p) => p.getTextContent())
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
              onClick={() => setPage((p) => p - 1)}
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
                    setPage(next);
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
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </PreviewAction>
          </div>
          <div className="flex items-center gap-1 border-border border-l pl-2">
            <PreviewAction
              size="sm"
              label="Zoom out"
              disabled={zoom <= 0.5}
              onClick={() => setZoom((z) => z - 0.25)}
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
              onClick={() => setZoom((z) => z + 0.25)}
            >
              <Plus />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Fit width"
              onClick={() => {
                setZoom(1);
                setFitPage(false);
              }}
            >
              <Maximize2 />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Fit page"
              onClick={() => {
                setZoom(1);
                setFitPage(true);
              }}
            >
              <Scan />
            </PreviewAction>
            <PreviewAction
              size="sm"
              label="Rotate clockwise"
              onClick={() => setRotation((r) => (r + 90) % 360)}
            >
              <RotateCw />
            </PreviewAction>
          </div>
          <div className="ml-auto">
            <PreviewAction
              size="sm"
              label={textView ? "Page view" : "Text view"}
              onClick={() => setTextView((v) => !v)}
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
