import {
  preparePlot,
  responsivePlot,
} from "../managed/plugins/vega-lite/widgets/plot-layout";
import { describe, expect, it } from "vitest";
import { View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { exampleVisual } from "../managed/plugins/vega-lite/widgets/example";
import {
  createRuntime,
  denyLoader,
} from "../managed/plugins/vega-lite/widgets/runtime";
import {
  isVisual,
  parameterDefaults,
  parameterNames,
  scenarioContext,
  serializeScenario,
  validateSpec,
} from "../managed/plugins/vega-lite/widgets/visual";

describe("native research visuals", () => {
  it("admits optional-value and dollar-named parameters without persisting expressions or selections", async () => {
    const spec = {
      mark: "point",
      params: [
        { name: "$growth", bind: { input: "range", min: 0, max: 10 } },
        { name: "derived", expr: "1 + 2" },
        { name: "selected", select: "point" },
      ],
    };
    expect(parameterNames(spec)).toEqual(["$growth"]);
    expect(parameterDefaults(spec)).toEqual({});
    const artifact = {
      ...exampleVisual,
      data: { ...exampleVisual.data, spec, parameters: { $growth: 4 } },
    };
    expect(isVisual(artifact)).toBe(true);
    expect(
      isVisual({
        ...artifact,
        data: { ...artifact.data, parameters: { derived: 8 } },
      }),
    ).toBe(false);
    const view = new View(createRuntime(spec), {
      expr: expressionInterpreter,
      loader: denyLoader,
      renderer: "none",
    });
    try {
      await view.signal("$growth", 4).runAsync();
      expect(view.signal("$growth")).toBe(4);
      expect(view.signal("derived")).toBe(3);
    } finally {
      view.finalize();
    }
  });
  it("fits simple plots to native padded bounds while preserving composed child dimensions and palette", () => {
    const theme = {
      foreground: "white",
      secondary: "silver",
      border: "gray",
      series: ["blue", "orange"],
    };
    const simple = {
      mark: "line",
      width: 800,
      height: 600,
      config: {
        axis: { labelFontSize: 14, labelColor: "black" },
        axisX: { titleColor: "black", tickSize: 5 },
        range: { category: ["red", "green"] },
      },
    };
    const fitted = preparePlot(simple, theme, 360);
    expect(fitted).toMatchObject({
      width: 360,
      height: 300,
      autosize: { type: "fit", contains: "padding" },
      config: {
        background: "transparent",
        axis: {
          labelFontSize: 14,
          labelColor: "white",
          labelOverlap: "greedy",
          labelSeparation: 4,
        },
        axisX: { titleColor: "white", tickSize: 5 },
        range: { category: ["red", "green"] },
      },
    });
    expect(
      preparePlot(
        { ...simple, config: { axis: { labelOverlap: false } } },
        theme,
        360,
      ).config?.axis?.labelOverlap,
    ).toBe(false);
    const facet = {
      facet: { field: "category" },
      spec: { mark: "bar", width: 180, height: 140 },
    };
    expect(responsivePlot(facet)).toBe(false);
    expect(preparePlot(facet, theme, 360).spec).toEqual(facet.spec);
    expect(preparePlot(facet, theme, 360)).not.toHaveProperty("width");
  });
  it("downloads compact reopenable snapshots and rejects oversized saved parameter values", () => {
    const large = {
      ...exampleVisual,
      data: {
        ...exampleVisual.data,
        spec: {
          mark: "point",
          data: {
            values: Array.from({ length: 7000 }, (_, index) => ({
              x: index,
              y: index,
            })),
          },
        },
      },
    };
    expect(isVisual(large)).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(large, null, 2)).length,
    ).toBeGreaterThan(262144);
    const serialized = serializeScenario(large, {});
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(
      262144,
    );
    expect(isVisual(JSON.parse(serialized))).toBe(true);
    const params = Array.from({ length: 70 }, (_, index) => ({
      name: `parameter${index}`,
      value: "",
    }));
    const small = {
      ...exampleVisual,
      data: { ...exampleVisual.data, spec: { mark: "point", params } },
    };
    expect(isVisual(small)).toBe(true);
    expect(() =>
      serializeScenario(
        small,
        Object.fromEntries(params.map((p) => [p.name, "x".repeat(4000)])),
      ),
    ).toThrow("limits");
  });

  it("round-trips scalar parameters and rejects undeclared saved state", () => {
    expect(isVisual(exampleVisual)).toBe(true);
    const saved = {
      ...exampleVisual,
      data: { ...exampleVisual.data, parameters: { growth: 3 } },
    };
    expect(isVisual(saved)).toBe(true);
    expect(
      isVisual({
        ...saved,
        data: { ...saved.data, parameters: { invented: 3 } },
      }),
    ).toBe(false);
    expect(parameterDefaults(exampleVisual.data.spec)).toEqual({
      growth: 8,
      margin: 15,
      multiple: 18,
    });
    expect(scenarioContext(saved, { growth: 3 })).toContain('"growth":3');
  });
  it("rejects external resources, DOM binding selectors, image marks and excessive nesting", async () => {
    for (const spec of [
      { data: { url: "https://example.com/data.json" } },
      { mark: "image" },
      { encoding: { href: { value: "https://example.com" } } },
      { params: [{ name: "x", value: 1, bind: { element: "body" } }] },
    ])
      expect(validateSpec(spec)).toBe(false);
    expect(
      validateSpec({
        mark: "line",
        data: { sequence: { start: 0, stop: 1e9 } },
      }),
    ).toBe(false);
    expect(
      validateSpec({
        mark: "line",
        data: { sequence: { start: 0, stop: 20 } },
      }),
    ).toBe(true);
    let nested: unknown = {};
    for (let i = 0; i < 45; i++) nested = { child: nested };
    expect(validateSpec(nested)).toBe(false);
    await expect(denyLoader.load("data:application/json,[]")).rejects.toThrow(
      "cannot load",
    );
    await expect(
      denyLoader.sanitize("https://example.com", {}),
    ).rejects.toThrow("cannot load");
  });
  it("runs artifact-owned transforms and changes native parameters with the interpreter", async () => {
    const spec = {
      data: { values: [{ revenue: 100 }] },
      params: [{ name: "growth", value: 0.1 }],
      transform: [
        { calculate: "datum.revenue * (1 + growth)", as: "projection" },
      ],
      mark: "bar",
      encoding: { y: { field: "projection", type: "quantitative" } },
    };
    const view = new View(createRuntime(spec), {
      expr: expressionInterpreter,
      loader: denyLoader,
      renderer: "none",
    });
    try {
      await view.runAsync();
      expect(view.data("data_0")[0].projection).toBeCloseTo(110);
      await view.signal("growth", 0.2).runAsync();
      expect(view.data("data_0")[0].projection).toBeCloseTo(120);
      expect(await view.toSVG()).toContain("<svg");
    } finally {
      view.finalize();
    }
  });
  it("admits native input bindings while rejecting resource and event attributes", () => {
    const spec = (bind: unknown) => ({
      mark: "point",
      params: [{ name: "x", value: 1, bind }],
    });
    expect(validateSpec(spec({ input: "range", min: 0, max: 10 }))).toBe(true);
    expect(
      validateSpec(spec({ field: { input: "select", options: [1, 2] } })),
    ).toBe(true);
    for (const bind of [
      { input: "select" },
      { input: "radio" },
      { input: "image", src: "https://example.com/pixel", onerror: "alert(1)" },
      { input: "text", onerror: "alert(1)" },
      { input: "range", src: "https://example.com" },
      { field: { input: "text", onfocus: "alert(1)" } },
    ])
      expect(validateSpec(spec(bind))).toBe(false);
  });
  it("supports explicitly static runtimes without changing interactive plot defaults", () => {
    const spec = {
      data: { values: [{ x: 1 }] },
      mark: "point",
      params: [{ name: "selected", select: "point" }],
      encoding: { x: { field: "x", type: "quantitative" } },
    };
    expect(createRuntime(spec, false).streams).toHaveLength(0);
    expect(createRuntime(spec, true).streams?.length).toBeGreaterThan(0);
  });
});
