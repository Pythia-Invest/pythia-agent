import { View, logger } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { createRuntime, denyLoader } from "./runtime";
import { preparePlot, responsivePlot, type PlotTheme } from "./plot-layout";
import { restoreExportState } from "./export-state";
import { assertSafeSvg } from "./svg";
import type { Scalar, Visual } from "./visual";

/** Export a fresh native view, independent of the current panel's pixel size. */
export async function exportVisual(
  visual: Visual,
  parameters: Record<string, Scalar>,
  theme: PlotTheme & { background: string },
  format: "svg" | "png",
  currentView?: View,
): Promise<Blob> {
  const spec = preparePlot(visual.data.spec, theme, 1200);
  // Downloads carry their captured theme even in a transparent-image viewer.
  spec.background = theme.background;
  if (responsivePlot(spec)) spec.height = 600;
  let failure = false;
  const log = logger(0);
  log.error = () => {
    failure = true;
    return log;
  };
  const view = new View(createRuntime(spec, false), {
    expr: expressionInterpreter,
    loader: denyLoader,
    renderer: "none",
    logger: log,
  });
  try {
    view.initialize(document.createElement("div"));
    for (const [name, value] of Object.entries(parameters))
      view.signal(name, value);
    await view.runAsync();
    if (currentView)
      await restoreExportState(
        view,
        currentView,
        responsivePlot(spec) ? { width: 1200, height: 600 } : undefined,
      );
    if (failure) throw new Error("The visual calculation failed.");
    // Native serialization uses the same final render dimensions as toCanvas.
    // Read them before allocating the 2x raster, including composed layouts.
    const svg = await view.toSVG();
    const opening = svg.slice(0, svg.indexOf(">") + 1);
    const w = Number(/\bwidth="([0-9.]+)"/.exec(opening)?.[1]);
    const h = Number(/\bheight="([0-9.]+)"/.exec(opening)?.[1]);
    if (
      !Number.isFinite(w + h) ||
      w <= 0 ||
      h <= 0 ||
      w > 4096 ||
      h > 4096 ||
      w * h > 8_000_000
    )
      throw new Error(
        "This visual is too large to export. Reduce its dimensions.",
      );
    if (format === "svg")
      return new Blob([assertSafeSvg(svg)], {
        type: "image/svg+xml",
      });
    const canvas = await view.toCanvas(2);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("PNG export failed.")),
        "image/png",
      ),
    );
  } finally {
    view.finalize();
  }
}
