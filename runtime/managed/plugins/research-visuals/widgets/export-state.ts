import type { View } from "vega";

/** Restore native selection state at its original dimensions before resizing.
 * Vega's scale-change handlers then reproject brushes from data coordinates. */
export async function restoreExportState(
  target: View,
  source: View,
  size?: { width: number; height: number },
) {
  type State = { signals?: Record<string, unknown>; subcontext?: State[] };
  const state = source.getState() as State;
  // Scenegraph objects belong to the source View. Native selection stores live
  // in datasets; only primitive/date/domain-array signals cross to the clone.
  const domainValue = (value: unknown, depth = 0): boolean =>
    value === null ||
    ["string", "number", "boolean", "undefined"].includes(typeof value) ||
    value instanceof Date ||
    (depth < 4 &&
      Array.isArray(value) &&
      value.length <= 10000 &&
      value.every((item) => domainValue(item, depth + 1)));
  const omitRuntimeObjects = (value: State) => {
    for (const [name, signal] of Object.entries(value.signals ?? {})) {
      if (
        ["padding", "autosize", "background", "unit"].includes(name) ||
        !domainValue(signal)
      )
        delete value.signals?.[name];
    }
    for (const child of value.subcontext ?? []) omitRuntimeObjects(child);
  };
  omitRuntimeObjects(state);
  target.setState(structuredClone(state));
  await target.runAsync();
  if (size) target.width(size.width).height(size.height);
  await target.resize().runAsync();
}
