import type { TopLevelSpec } from "vega-lite";
export type Scalar = string | number | boolean | null;
export type Visual = {
  format: "pythia-visual";
  version: 1;
  title: string;
  summary: string;
  presentation: {
    plugin: "pythia-vega-lite";
    widget: "research-visual";
    input_contract: "pythia.vega-lite.v1";
  };
  data: {
    kind: "vega-lite";
    asOf: string;
    sources: { label: string; url?: string; date?: string }[];
    assumptions: string[];
    spec: Record<string, unknown>;
    parameters?: Record<string, Scalar>;
  };
};
const text = (v: unknown, limit = 4000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= limit;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export const scalar = (v: unknown): v is Scalar =>
  v === null ||
  typeof v === "boolean" ||
  (typeof v === "string" && v.length <= 4000) ||
  (typeof v === "number" && Number.isFinite(v));
export function safeSourceUrl(url: string): boolean {
  try {
    return ["https:", "http:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
/** Vega bind.js copies arbitrary input attributes; admit only native safe controls. */
export function validateBinding(value: unknown, depth = 0): boolean {
  if (value === "legend" || value === "scales") return true;
  if (!record(value) || depth > 8) return false;
  if (!Object.hasOwn(value, "input"))
    return (
      Object.keys(value).length > 0 &&
      Object.values(value).every(
        (v) => record(v) && validateBinding(v, depth + 1),
      )
    );
  if (
    !["range", "select", "radio", "checkbox", "text", "number"].includes(
      String(value.input),
    )
  )
    return false;
  if (["select", "radio"].includes(String(value.input)) && !Array.isArray(value.options))
    return false;
  const allowed = [
    "input",
    "name",
    "min",
    "max",
    "step",
    "options",
    "labels",
    "debounce",
  ];
  return Object.entries(value).every(([key, val]) => {
    if (!allowed.includes(key)) return false;
    if (key === "input") return true;
    if (key === "name") return text(val, 240);
    if (key === "options")
      return Array.isArray(val) && val.length <= 1000 && val.every(scalar);
    if (key === "labels")
      return (
        Array.isArray(val) &&
        val.length <= 1000 &&
        val.every((v) => typeof v === "string" && v.length <= 4000)
      );
    if (
      typeof val !== "number" ||
      !Number.isFinite(val) ||
      Math.abs(val) > 1e15
    )
      return false;
    if (key === "step") return val > 0;
    if (key === "debounce") return val >= 0 && val <= 60000;
    return true;
  });
}
/** Resource access is also denied by Vega's loader. Prevent external DOM bindings and resource marks before compilation. */
export function validateSpec(
  spec: unknown,
): spec is Record<string, unknown> & TopLevelSpec {
  if (
    !record(spec) ||
    !["mark", "layer", "facet", "repeat", "concat", "hconcat", "vconcat"].some(
      (key) => Object.hasOwn(spec, key),
    )
  )
    return false;
  let nodes = 0;
  const walk = (value: unknown, depth: number): boolean => {
    if (++nodes > 40000 || depth > 40) return false;
    if (Array.isArray(value))
      return value.length <= 10000 && value.every((v) => walk(v, depth + 1));
    if (record(value))
      return Object.entries(value).every(([key, v]) => {
        if (
          [
            "__proto__",
            "prototype",
            "constructor",
            "url",
            "href",
            "element",
          ].includes(key)
        )
          return false;
        if (
          key === "mark" &&
          (v === "image" || (record(v) && v.type === "image"))
        )
          return false;
        if (key === "bind" && !validateBinding(v)) return false;
        if (key === "sequence") {
          if (!record(v)) return false;
          const start = v.start ?? 0;
          const step = v.step ?? 1;
          const stop = v.stop;
          if (
            typeof start !== "number" ||
            typeof stop !== "number" ||
            typeof step !== "number" ||
            !Number.isFinite(start) ||
            !Number.isFinite(stop) ||
            !Number.isFinite(step) ||
            step === 0 ||
            Math.ceil(Math.abs((stop - start) / step)) > 10000
          )
            return false;
        }
        return walk(v, depth + 1);
      });
    return (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "string" && value.length <= 16000) ||
      (typeof value === "number" && Number.isFinite(value))
    );
  };
  return walk(spec, 0);
}
/** Only independent top-level variable parameters are durable scenario choices. */
export function parameterNames(spec: Record<string, unknown>): string[] {
  if (!Array.isArray(spec.params)) return [];
  return spec.params.flatMap((param) =>
    record(param) &&
    typeof param.name === "string" &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param.name) &&
    !["__proto__", "prototype", "constructor"].includes(param.name) &&
    !Object.hasOwn(param, "select") &&
    !Object.hasOwn(param, "expr")
      ? [param.name]
      : [],
  );
}
export function parameterDefaults(
  spec: Record<string, unknown>,
): Record<string, Scalar> {
  const names = new Set(parameterNames(spec));
  const params: Record<string, Scalar> = {};
  if (Array.isArray(spec.params))
    for (const param of spec.params) {
      if (
        record(param) &&
        typeof param.name === "string" &&
        names.has(param.name) &&
        scalar(param.value)
      )
        params[param.name] = param.value;
    }
  return params;
}
export function isVisual(value: unknown): value is Visual {
  try {
    const v = value as Visual;
    if (
      new TextEncoder().encode(JSON.stringify(value)).length > 262144 ||
      v.format !== "pythia-visual" ||
      v.version !== 1 ||
      !text(v.title, 200) ||
      !text(v.summary, 2000)
    )
      return false;
    if (
      v.presentation.plugin !== "pythia-vega-lite" ||
      v.presentation.widget !== "research-visual" ||
      v.presentation.input_contract !== "pythia.vega-lite.v1"
    )
      return false;
    const d = v.data;
    if (d.kind !== "vega-lite" || !date(d.asOf) || !validateSpec(d.spec))
      return false;
    if (
      !Array.isArray(d.sources) ||
      d.sources.length > 20 ||
      !d.sources.every(
        (s) =>
          text(s.label, 240) &&
          (!s.url || (text(s.url, 2048) && safeSourceUrl(s.url))) &&
          (!s.date || date(s.date)),
      )
    )
      return false;
    if (
      !Array.isArray(d.assumptions) ||
      d.assumptions.length > 20 ||
      !d.assumptions.every((a) => text(a, 1000))
    )
      return false;
    const declared = new Set(parameterNames(d.spec));
    return (
      d.parameters === undefined ||
      (record(d.parameters) &&
        Object.keys(d.parameters).length <= 64 &&
        Object.entries(d.parameters).every(
          ([k, val]) => declared.has(k) && scalar(val),
        ))
    );
  } catch {
    return false;
  }
}
export function scenarioContext(
  visual: Visual,
  parameters: Record<string, Scalar>,
): string {
  return `${visual.title}\nSnapshot: ${visual.data.asOf}\nCurrent parameters: ${JSON.stringify(parameters)}\nAssumptions:\n${visual.data.assumptions.join("\n")}\nThe parameters are local scenario choices, not verified forecasts. The artifact preserves the calculation expressions and source data.`;
}

/** Download exactly the compact representation admitted by the reader. */
export function serializeScenario(
  visual: Visual,
  parameters: Record<string, Scalar>,
): string {
  const artifact = { ...visual, data: { ...visual.data, parameters } };
  if (!isVisual(artifact))
    throw new Error("Scenario exceeds the supported artifact limits.");
  return JSON.stringify(artifact);
}
