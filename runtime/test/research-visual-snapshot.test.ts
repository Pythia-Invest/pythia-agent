import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { View } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import {
  createRuntime,
  denyLoader,
} from "../managed/plugins/vega-lite/widgets/runtime";
import {
  MAX_SNAPSHOT_INPUT_BYTES,
  renderSnapshot,
  renderSnapshotInput,
  SNAPSHOT_ERROR,
} from "../managed/plugins/vega-lite/snapshot";
import type { Visual } from "../managed/plugins/vega-lite/widgets/visual";
import { assertSafeSvg } from "../managed/plugins/vega-lite/widgets/svg";

// Synthetic native Vega-Lite text marks make recalculated values observable
// without relying on incidental SVG paths or layout measurements.
function artifact(): Visual {
  return {
    format: "pythia-visual",
    version: 1,
    title: "Synthetic calculation",
    summary: "Synthetic data for snapshot verification.",
    presentation: {
      plugin: "pythia-vega-lite",
      widget: "research-visual",
      input_contract: "pythia.vega-lite.v1",
    },
    data: {
      kind: "vega-lite",
      asOf: "2026-09-22",
      sources: [],
      assumptions: [],
      parameters: { multiple: 7 },
      spec: {
        width: 400,
        height: 200,
        params: [{ name: "multiple", value: 2 }],
        data: { values: [{ earnings: 13 }] },
        transform: [
          { calculate: "datum.earnings * multiple", as: "valuation" },
        ],
        mark: "text",
        encoding: { text: { field: "valuation", type: "quantitative" } },
      },
    },
  };
}

describe("research visual SVG snapshots", () => {
  it.each(["literal", "expression", "data"])(
    "rejects external SVG paints from %s colors",
    async (source) => {
      const visual = artifact();
      const paint = "url(https://example.invalid/paint.svg#x)";
      visual.data.spec = {
        data: { values: [{ paint }] },
        mark:
          source === "data"
            ? "point"
            : {
                type: "point",
                color:
                  source === "literal"
                    ? paint
                    : { expr: JSON.stringify(paint) },
              },
        ...(source === "data"
          ? {
              encoding: {
                color: { field: "paint", type: "nominal", scale: null },
              },
            }
          : {}),
      };
      delete visual.data.parameters;
      const rawView = new View(createRuntime(visual.data.spec), {
        renderer: "none",
        loader: denyLoader,
        expr: expressionInterpreter,
      });
      try {
        // Demonstrate the loader bypass in native SVG output, then assert that
        // Pythia's export boundary rejects that exact supported specification.
        expect(await rawView.toSVG()).toContain(paint);
      } finally {
        rawView.finalize();
      }
      await expect(renderSnapshot(visual)).rejects.toThrow(SNAPSHOT_ERROR);
      visual.data.spec = {
        data: { values: [{ x: 1, y: 2 }] },
        mark: { type: "point", clip: true },
        encoding: {
          x: { field: "x", type: "quantitative" },
          y: { field: "y", type: "quantitative" },
        },
      };
      const svg = await renderSnapshot(visual);
      expect(svg).toContain('clip-path="url(#');
    },
  );

  it.each([
    'fill="u&#114;l(https://example.invalid/a)"',
    'fill="URL( &quot;https://example.invalid/a&quot; )"',
    'fill="u\\72l(https://example.invalid/a)"',
    'fill="url(/*comment*/https://example.invalid/a)"',
    'xlink:href="https://example.invalid/a"',
    'onload="run()"',
  ])(
    "rejects encoded paint resources and active attributes: %s",
    (attribute) => {
      expect(() =>
        assertSafeSvg(
          `<svg xmlns="http://www.w3.org/2000/svg"><path ${attribute}/></svg>`,
        ),
      ).toThrow();
    },
  );

  it.each(["script", "style", "image", "foreignObject"])(
    "rejects unexpected generated %s elements",
    (tag) => {
      expect(() =>
        assertSafeSvg(
          `<svg xmlns="http://www.w3.org/2000/svg"><${tag}/></svg>`,
        ),
      ).toThrow();
    },
  );

  it("exports responsive specifications and bound controls without a DOM", async () => {
    const visual = artifact();
    visual.data.spec.width = "container";
    visual.data.spec.params = [
      { name: "multiple", value: 2, bind: { input: "range", min: 1, max: 10 } },
    ];
    const svg = await renderSnapshot(visual);
    expect(svg).toContain(">91</text>");
    expect(svg).not.toContain("NaN");
  });

  it("renders saved parameters with the AST interpreter and no Function codegen", async () => {
    const forbidden = vi
      .spyOn(globalThis, "Function")
      .mockImplementation(() => {
        throw new Error("Code generation forbidden");
      });
    try {
      const svg = await renderSnapshot(artifact());
      expect(svg).toContain("<svg");
      expect(svg).toContain(">91</text>");
      expect(forbidden).not.toHaveBeenCalled();
    } finally {
      forbidden.mockRestore();
    }
  });

  it.each([
    { data: { url: "file:///private/sensitive.json" } },
    { mark: { type: "image" } },
    { encoding: { href: { value: "https://example.invalid/private" } } },
  ])("rejects resource and navigation specifications: %j", async (unsafe) => {
    const visual = artifact();
    Object.assign(visual.data.spec, unsafe);
    await expect(renderSnapshot(visual)).rejects.toThrow(SNAPSHOT_ERROR);
  });

  it("does not expose malformed expression contents in errors or logs", async () => {
    const visual = artifact();
    visual.data.spec.transform = [
      { calculate: "PRIVATE_INVESTOR_VALUE(", as: "x" },
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(renderSnapshot(visual)).rejects.toThrow(SNAPSHOT_ERROR);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      warn.mockRestore();
    }
  });

  it("bounds streamed input before parsing and handles malformed JSON generically", async () => {
    await expect(
      renderSnapshotInput(
        Readable.from([
          Buffer.alloc(MAX_SNAPSHOT_INPUT_BYTES),
          Buffer.from("x"),
        ]),
      ),
    ).rejects.toThrow(SNAPSHOT_ERROR);
    await expect(
      renderSnapshotInput(Readable.from([Buffer.from('{"private":')])),
    ).rejects.toThrow(SNAPSHOT_ERROR);
    const svg = await renderSnapshotInput(
      Readable.from([Buffer.from(JSON.stringify(artifact()))]),
    );
    expect(svg).toContain(">91</text>");
  });

  it("rejects generated output exceeding the SVG limit", async () => {
    const visual = artifact();
    visual.data.spec = {
      data: { values: [{ label: "x".repeat(1000) }] },
      transform: [
        { calculate: "sequence(0, 3000)", as: "items" },
        { flatten: ["items"] },
      ],
      mark: "text",
      encoding: { text: { field: "label" } },
    };
    delete visual.data.parameters;
    await expect(renderSnapshot(visual)).rejects.toThrow(SNAPSHOT_ERROR);
    visual.data.spec.transform = [
      { calculate: "sequence(0, 3)", as: "items" },
      { flatten: ["items"] },
    ];
    await expect(renderSnapshot(visual)).resolves.toContain("<svg");
  });
});

describe("research visual expression authority", () => {
  const spec = (params: unknown[]) => ({
    width: 200,
    height: 200,
    data: {
      values: [
        { x: 1, y: 2, category: "A" },
        { x: 2, y: 3, category: "B" },
      ],
    },
    params,
    mark: "point",
    encoding: {
      x: { field: "x", type: "quantitative" },
      y: { field: "y", type: "quantitative" },
      color: { field: "category", type: "nominal" },
    },
  });

  it.each([
    "event.target.ownerDocument.body.textContent",
    "event['target'].ownerDocument.body.textContent",
    "event['tar' + 'get'].value",
    "event.dataflow._el.ownerDocument.body.textContent",
    "view()._el.ownerDocument.body.textContent",
    "item().mark.group.context.dataflow._el.textContent",
    "group().context.dataflow._el.textContent",
    "pluck(item(), 'mark.group.context')",
    "intersect([[0,0],[100,100]])[0].mark.group.context",
    "screen().orientation",
    "(item() || {}).mark.group.context",
    "{leaked: event.item}",
    "isTuple(group()) ? group() : unit",
  ])("rejects authored parameter event escape: %s", (update) => {
    expect(() =>
      createRuntime(
        spec([
          { name: "leaked", value: "", on: [{ events: "click", update }] },
          { name: "selected", select: "point" },
        ]),
      ),
    ).toThrow();
  });

  it.each([
    "event.target.ownerDocument.body.textContent",
    "item().mark.group.context.dataflow",
    "event['tar' + 'get'].value",
    "view()",
  ])("rejects native selection expression escape: %s", (toggle) => {
    expect(() =>
      createRuntime(
        spec([{ name: "selected", select: { type: "point", toggle } }]),
      ),
    ).toThrow();
  });

  it.each(["window:keydown", "body:click", "input:input", "document:click"])(
    "rejects application event source %s",
    (on) => {
      expect(() =>
        createRuntime(
          spec([{ name: "selected", select: { type: "point", on } }]),
        ),
      ).toThrow();
    },
  );

  it("blocks signal aliases and computed prototype traversal", () => {
    for (const expr of [
      "datum['con' + 'structor']",
      "datum.constructor",
      "datum.__proto__",
      "datum.items[0].source",
    ]) {
      expect(() =>
        createRuntime({
          ...spec([]),
          transform: [{ calculate: expr, as: "leak" }],
        }),
      ).toThrow();
    }
    expect(() =>
      createRuntime(
        spec([
          {
            name: "leaked",
            value: "",
            on: [{ events: "click", update: "item() || {}" }],
          },
        ]),
      ),
    ).toThrow();
  });

  it("keeps point, legend, interval and scale-bound native selections", async () => {
    for (const params of [
      [
        {
          name: "selected",
          select: { type: "point", toggle: "event.shiftKey || event.ctrlKey" },
        },
      ],
      [
        {
          name: "selected",
          select: { type: "point", fields: ["category"] },
          bind: "legend",
        },
      ],
      [
        {
          name: "selected",
          select: {
            type: "interval",
            on: "[pointerdown[event.shiftKey], window:pointerup] > window:pointermove!",
          },
        },
      ],
      [{ name: "selected", select: "interval", bind: "scales" }],
    ]) {
      const view = new View(createRuntime(spec(params)), {
        expr: expressionInterpreter,
        loader: denyLoader,
        renderer: "none",
      });
      try {
        await view.runAsync();
        expect(await view.toSVG()).toContain("<svg");
      } finally {
        view.finalize();
      }
    }
  });

  it("renders native facet headers and repeated views", async () => {
    const base = spec([]);
    for (const composed of [
      {
        data: base.data,
        facet: { field: "category" },
        spec: {
          mark: "point",
          encoding: base.encoding,
        },
      },
      {
        data: base.data,
        repeat: ["x", "y"],
        spec: {
          mark: "bar",
          encoding: {
            x: { field: { repeat: "repeat" }, type: "quantitative" },
          },
        },
      },
    ]) {
      const view = new View(createRuntime(composed), {
        expr: expressionInterpreter,
        loader: denyLoader,
        renderer: "none",
      });
      try {
        await view.runAsync();
        expect(await view.toSVG()).toContain("<svg");
      } finally {
        view.finalize();
      }
    }
  });

  it("executes native drag filters and interval updates with scalar modifiers", async () => {
    const windowListeners = new Map<string, ((event: unknown) => void)[]>();
    vi.stubGlobal("window", {
      addEventListener(type: string, listener: (event: unknown) => void) {
        windowListeners.set(type, [
          ...(windowListeners.get(type) ?? []),
          listener,
        ]);
      },
      removeEventListener() {},
    });
    const view = new View(
      createRuntime(
        spec([
          {
            name: "brush",
            select: {
              type: "interval",
              on: "[pointerdown[event.shiftKey], window:pointerup] > window:pointermove!",
            },
          },
        ]),
      ),
      { expr: expressionInterpreter, loader: denyLoader, renderer: "none" },
    );
    // Native View.events extends pointer events using renderer canvas geometry.
    // Supply only that geometry and a no-op renderer: no browser/network needed.
    const native = view as unknown as {
      _renderer: unknown;
      _handler: { _active: unknown; fire(type: string, event: unknown): void };
    };
    try {
      await view.runAsync();
      native._renderer = {
        canvas: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }),
        dirty() {},
        resize() {},
        background() {},
        renderAsync: async () => {},
      };
      native._handler._active = view.scenegraph().root.items[0];
      const fire = async (type: string, x: number, shiftKey = false) => {
        const event = {
          clientX: x,
          clientY: 60,
          shiftKey,
          preventDefault() {},
          stopPropagation() {},
        };
        native._handler.fire(type, { ...event });
        await view.runAsync();
        for (const listener of windowListeners.get(type) ?? [])
          listener({ ...event });
        await view.runAsync();
      };
      await fire("pointermove", 20);
      await fire("pointerdown", 30);
      await fire("pointermove", 90);
      expect(view.signal("brush_x_1")).toEqual([]);
      await fire("pointerdown", 30, true);
      await fire("pointermove", 90, true);
      const extent = view.signal("brush_x_1") as number[];
      const [start, end] = extent;
      expect(typeof start).toBe("number");
      expect(typeof end).toBe("number");
      if (start === undefined || end === undefined)
        throw new Error("Missing brush extent");
      expect(end - start).toBe(60);
      await fire("pointerup", 90);
      await fire("pointermove", 140);
      expect(view.signal("brush_x_1")).toEqual(extent);
    } finally {
      native._renderer = null;
      view.finalize();
      vi.unstubAllGlobals();
    }
  });
});
