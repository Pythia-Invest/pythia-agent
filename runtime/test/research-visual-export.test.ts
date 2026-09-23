import { expect, it } from "vitest";
import { View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import {
  createRuntime,
  denyLoader,
} from "../managed/plugins/vega-lite/widgets/runtime";
import { restoreExportState } from "../managed/plugins/vega-lite/widgets/export-state";

it.each([false, true])(
  "reprojects native interval brushes without changing the data range (fit=%s)",
  async (fit) => {
    const spec = {
      width: 300,
      height: 200,
      ...(fit
        ? { autosize: { type: "fit", contains: "padding", resize: true } }
        : {}),
      data: {
        values: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
      params: [
        { name: "brush", select: { type: "interval", encodings: ["x"] } },
      ],
      mark: "point",
      encoding: {
        x: { field: "x", type: "quantitative", scale: { domain: [0, 10] } },
        y: { field: "y", type: "quantitative" },
      },
    };
    const make = (interactive: boolean) =>
      new View(createRuntime(spec, interactive), {
        renderer: "none",
        expr: expressionInterpreter,
        loader: denyLoader,
      });
    const source = make(true),
      target = make(false);
    try {
      await source.runAsync();
      const initialPixels = [source.scale("x")(2), source.scale("x")(5)];
      await source.signal("brush_x_1", initialPixels).runAsync();
      expect(source.signal("brush_x")).toEqual([2, 5]);
      await target.runAsync();
      await restoreExportState(target, source, { width: 1200, height: 600 });
      expect(target.signal("brush_x")).toEqual([2, 5]);
      expect(target.signal("brush_x_1")).toEqual([
        target.scale("x")(2),
        target.scale("x")(5),
      ]);
      expect(target.data("brush_store")).toMatchObject([{ values: [[2, 5]] }]);
      expect(source.signal("brush_x_1")).toEqual(initialPixels);
      const svg = await target.toSVG();
      if (!fit) expect(svg).toContain("M240,0h360v600h-360Z");
      else expect(svg).toContain('width="1200" height="600"');
    } finally {
      source.finalize();
      target.finalize();
    }
  },
);
