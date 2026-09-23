import type { Config, TopLevelSpec } from "vega-lite";
import { validateSpec } from "./visual";
export type PlotTheme = {
  foreground: string;
  secondary: string;
  border: string;
  series: string[];
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Fit only single-view plots. Facets/concats retain their own child sizing and scroll if needed. */
export function responsivePlot(spec: Record<string, unknown>): boolean {
  return (
    !["facet", "repeat", "concat", "hconcat", "vconcat"].some((key) =>
      Object.hasOwn(spec, key),
    ) &&
    (Object.hasOwn(spec, "mark") || Object.hasOwn(spec, "layer")) &&
    typeof spec.width !== "object" &&
    typeof spec.height !== "object"
  );
}
export function preparePlot(
  specification: Record<string, unknown>,
  theme: PlotTheme,
  width: number,
): TopLevelSpec & Record<string, unknown> {
  if (!validateSpec(specification))
    throw new Error("Invalid visual specification.");
  const spec = structuredClone(specification);
  const config = record(spec.config);
  const axis = {
    labelOverlap: "greedy",
    labelSeparation: 4,
    ...record(config.axis),
    labelColor: theme.foreground,
    titleColor: theme.foreground,
    gridColor: theme.border,
    domainColor: theme.border,
    tickColor: theme.border,
  };
  const adjusted: Record<string, unknown> = {
    ...config,
    background: config.background ?? "transparent",
    view: { stroke: null, ...record(config.view) },
    axis,
    legend: {
      ...record(config.legend),
      labelColor: theme.foreground,
      titleColor: theme.foreground,
    },
    title: {
      ...record(config.title),
      color: theme.foreground,
      subtitleColor: theme.secondary,
    },
    text: { ...record(config.text), color: theme.foreground },
    range: { category: theme.series, ...record(config.range) },
  };
  for (const key of [
    "axisX",
    "axisY",
    "axisLeft",
    "axisRight",
    "axisTop",
    "axisBottom",
    "axisQuantitative",
    "axisTemporal",
    "axisDiscrete",
    "axisPoint",
    "axisBand",
  ]) {
    if (config[key])
      adjusted[key] = {
        ...record(config[key]),
        labelColor: theme.foreground,
        titleColor: theme.foreground,
        gridColor: theme.border,
        domainColor: theme.border,
        tickColor: theme.border,
      };
  }
  spec.config = adjusted as Config;
  if (responsivePlot(spec)) {
    const maxHeight = 300;
    spec.width = Math.max(1, Math.round(width));
    spec.height =
      typeof spec.height === "number"
        ? Math.min(spec.height, maxHeight)
        : maxHeight;
    spec.autosize = { type: "fit", contains: "padding", resize: true };
  }
  return spec;
}
