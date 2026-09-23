import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { View, logger } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { createRuntime, denyLoader } from "./runtime";
import { preparePlot, responsivePlot } from "./plot-layout";
import {
  parameterDefaults,
  parameterNames,
  scalar,
  type Scalar,
  type Visual,
} from "./visual";

export function Plot({
  visual,
  theme,
  onParameters,
  onView,
  onError,
}: {
  visual: Visual;
  theme: string | undefined;
  onParameters: (p: Record<string, Scalar>) => void;
  onView: (view: View | null) => void;
  onError?: ((message: string | null) => void) | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const tooltipBox = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxWidth: 260 });
  const bindings = useRef<HTMLDivElement>(null);
  const savedParameters = useRef({
    ...parameterDefaults(visual.data.spec),
    ...visual.data.parameters,
  });
  const current = useRef({ onParameters, onView, onError });
  current.current = { onParameters, onView, onError };
  const [error, setError] = useState("");
  const [tooltip, setTooltip] = useState<{ label: string; value: string }[]>(
    [],
  );
  useLayoutEffect(() => {
    const box = tooltipBox.current;
    const plot = ref.current;
    if (!box || !plot) return;
    setPosition((value) => ({
      ...value,
      top: Math.max(
        8,
        Math.min(value.top, plot.clientHeight - box.offsetHeight - 8),
      ),
    }));
  }, [tooltip]);
  useEffect(() => {
    const node = ref.current;
    const bind = bindings.current;
    if (!node || !bind) return;
    let view: View | undefined;
    let disposed = false;
    let failed = false;
    let ready = false;
    let observer: ResizeObserver | undefined;
    let lastWidth = node.clientWidth;
    let resizeQueue = Promise.resolve();
    current.current.onView(null);
    current.current.onError?.(null);
    setError("");
    setTooltip([]);
    const fail = (message: string) => {
      if (disposed || failed) return;
      failed = true;
      ready = false;
      observer?.disconnect();
      current.current.onView(null);
      current.current.onError?.(message);
      setError(message);
      setTooltip([]);
      // Dataflow loggers run inside Vega evaluation. Release after that stack exits.
      queueMicrotask(() => {
        if (disposed) return;
        view?.finalize();
        node.replaceChildren();
        bind.replaceChildren();
      });
    };
    try {
      const styles = getComputedStyle(node);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      const spec = preparePlot(
        visual.data.spec,
        {
          foreground: token("--py-text-primary"),
          secondary: token("--py-text-secondary"),
          border: token("--py-border-default"),
          series: [
            token("--py-artifact-document"),
            token("--py-artifact-folder"),
            token("--py-text-secondary"),
          ],
        },
        lastWidth,
      );
      const names = parameterNames(visual.data.spec);
      const parameters: Record<string, Scalar> = {};
      const runtimeLogger = logger(0);
      runtimeLogger.error = () => {
        fail(
          "A calculation in this visual failed. Retry the visual or inspect its specification.",
        );
        return runtimeLogger;
      };
      view = new View(createRuntime(spec), {
        logger: runtimeLogger,
        expr: expressionInterpreter,
        loader: denyLoader,
        renderer: "canvas",
        hover: true,
        tooltip: (_handler, event, _item, value) => {
          if (disposed || failed) return;
          setTooltip(
            value == null
              ? []
              : typeof value === "object"
                ? Object.entries(value).map(([label, item]) => ({
                    label,
                    value: item == null ? "—" : String(item),
                  }))
                : [{ label: "", value: String(value) }],
          );
          const bounds = wrapper.current?.getBoundingClientRect();
          if (bounds && value != null) {
            const width = Math.min(260, bounds.width - 16);
            const height = tooltipBox.current?.offsetHeight ?? 80;
            const x = event.clientX - bounds.left;
            const y = event.clientY - bounds.top;
            setPosition({
              left: Math.max(8, Math.min(x + 12, bounds.width - width - 8)),
              top: Math.max(
                8,
                y + height + 12 > (ref.current?.clientHeight ?? bounds.height)
                  ? y - height - 12
                  : y + 12,
              ),
              maxWidth: width,
            });
          }
        },
      }).initialize(node, bind);
      const owned = view;
      const capture = () => {
        if (disposed || failed) return;
        for (const name of names) {
          const value: unknown = owned.signal(name);
          if (scalar(value)) parameters[name] = value;
          else delete parameters[name];
        }
        savedParameters.current = { ...parameters };
        current.current.onParameters({ ...parameters });
      };
      for (const name of names) {
        if (Object.hasOwn(savedParameters.current, name))
          owned.signal(name, savedParameters.current[name]);
        owned.addSignalListener(name, () => {
          if (ready) capture();
        });
      }
      void owned
        .runAsync()
        .then(() => {
          if (disposed || failed) return;
          ready = true;
          capture();
          current.current.onView(owned);
        })
        .catch(() =>
          fail(
            "This visual could not be rendered. Retry or inspect its specification.",
          ),
        );
      if (responsivePlot(visual.data.spec)) {
        observer = new ResizeObserver(() => {
          const width = node.clientWidth;
          if (disposed || failed || width <= 0 || width === lastWidth) return;
          lastWidth = width;
          resizeQueue = resizeQueue
            .then(async () => {
              if (disposed || failed) return;
              await owned.width(width).resize().runAsync();
            })
            .catch(() =>
              fail("This visual could not be resized. Retry to restore it."),
            );
        });
        observer.observe(node);
      }
    } catch {
      fail(
        "This visual could not be rendered. Retry or inspect its specification.",
      );
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      view?.finalize();
      current.current.onView(null);
      node.replaceChildren();
      bind.replaceChildren();
    };
  }, [visual, theme]);
  return (
    <div ref={wrapper} className="relative min-w-0 space-y-3">
      <div ref={ref} className="w-full overflow-auto" />
      <div
        ref={bindings}
        className="space-y-3 text-xs [&_.vega-bind-name]:text-foreground-secondary [&_.vega-bind-radio]:flex [&_.vega-bind-radio]:flex-wrap [&_.vega-bind-radio]:gap-3 [&_.vega-bind>label>span:last-child:not(.vega-bind-name)]:text-right [&_.vega-bind>label>span:last-child:not(.vega-bind-name)]:tabular-nums [&_.vega-bind>label]:grid [&_.vega-bind>label]:grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)_3ch] [&_.vega-bind>label]:items-center [&_.vega-bind>label]:gap-3 [&_input[type=number]]:rounded-control [&_input[type=number]]:border [&_input[type=number]]:border-border [&_input[type=number]]:bg-canvas [&_input[type=range]]:w-full [&_input[type=range]]:cursor-pointer [&_input[type=text]]:rounded-control [&_input[type=text]]:border [&_input[type=text]]:border-border [&_input[type=text]]:bg-canvas [&_input]:min-w-0 [&_input]:accent-foreground [&_input]:outline-ring [&_select]:min-w-0 [&_select]:rounded-control [&_select]:border [&_select]:border-border [&_select]:bg-canvas"
      />
      {tooltip.length > 0 && !error && (
        <div
          ref={tooltipBox}
          role="status"
          className="pointer-events-none absolute z-20 rounded-control border border-border bg-overlay p-2 text-foreground text-xs shadow-popup"
          style={position}
        >
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-1.5 leading-normal">
            {tooltip.map(({ label, value }) => (
              <div key={label} className="contents">
                <dt className="min-w-0 break-words text-foreground-secondary">
                  {label}
                </dt>
                <dd className="max-w-40 break-words text-right font-medium tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {error && (
        <p role="alert" className="text-error text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
