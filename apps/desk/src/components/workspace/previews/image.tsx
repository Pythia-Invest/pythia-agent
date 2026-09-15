"use client";
import { PreviewAction } from "./action";
import { ZoomOut, ZoomIn, Scan, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
import { PreviewToolbar } from "./toolbar";
import { usePreviewViewport } from "./viewport";

export function RasterPreview({ url, name }: { url: string; name: string }) {
  const root = useRef<HTMLDivElement>(null);
  const area = usePreviewViewport(root);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const sideways = rotation % 180 !== 0;
  const width = sideways ? natural.height : natural.width;
  const height = sideways ? natural.width : natural.height;
  const scale =
    zoom ??
    Math.min(
      1,
      (area.width - 32) / (width || 1),
      (area.height - 32) / (height || 1),
    );
  return (
    <div ref={root} data-slot="workspace-raster">
      <PreviewToolbar label="Image tools">
        <PreviewAction
          size="sm"
          label="Zoom out"
          disabled={scale <= 0.1}
          onClick={() => setZoom(Math.max(0.1, scale / 1.25))}
        >
          <ZoomOut />
        </PreviewAction>
        <span className="w-10 text-center tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <PreviewAction
          size="sm"
          label="Zoom in"
          disabled={scale >= 4}
          onClick={() => setZoom(Math.min(4, scale * 1.25))}
        >
          <ZoomIn />
        </PreviewAction>
        <PreviewAction
          size="sm"
          label="Fit image"
          text="Fit"
          tip="Fit the entire image in the pane"
          onClick={() => setZoom(null)}
        >
          <Scan />
        </PreviewAction>
        <PreviewAction
          size="sm"
          label="Actual size"
          text="100%"
          tip={`Actual size · ${natural.width} × ${natural.height} pixels`}
          onClick={() => setZoom(1)}
        />
        <PreviewAction
          size="sm"
          label="Rotate clockwise"
          tip="Rotate 90° clockwise · view only"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          <RotateCw />
        </PreviewAction>
      </PreviewToolbar>
      {failed ? (
        <p role="status" className="p-4">
          This image could not be displayed. Download the original to open it.
        </p>
      ) : (
        <div className="overflow-auto p-4" style={{ height: area.height }}>
          <div
            className="relative mx-auto"
            style={{ width: width * scale, height: height * scale }}
          >
            <img
              data-slot="workspace-image"
              src={url}
              alt={name}
              className="absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: natural.width ? natural.width * scale : undefined,
                transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              }}
              onError={() => setFailed(true)}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
