/** Browser-local layout primitives. Only validated booleans and bounded geometry
 * may be projected before paint; never put research or form state in this schema. */
export type LayoutField =
  | { default: boolean; attribute: string }
  | {
      default: number;
      property: string;
      min: number;
      max: number;
      unit: "px" | "%";
    };
export type LayoutFields = Record<string, LayoutField>;
export type LayoutValues<T extends LayoutFields> = {
  [K in keyof T]: T[K]["default"] extends boolean ? boolean : number;
};
export type LayoutDefinition = { key: string; fields: LayoutFields };

// These functions are also serialized into the head bootstrap. Keep them
// self-contained so startup and React use exactly the same validation/projection.
export function parseLayout(fields: LayoutFields, raw: string | null) {
  let parsed: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (value && typeof value === "object" && !Array.isArray(value))
      parsed = value as Record<string, unknown>;
  } catch {
    /* Missing or corrupt preferences restore defaults. */
  }
  const result: Record<string, boolean | number> = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = parsed[key];
    result[key] =
      "attribute" in field
        ? typeof value === "boolean"
          ? value
          : field.default
        : typeof value === "number" && Number.isFinite(value)
          ? Math.max(field.min, Math.min(field.max, value))
          : field.default;
  }
  return result;
}

function projectLayout(
  fields: LayoutFields,
  values: Record<string, boolean | number>,
  root: HTMLElement,
) {
  for (const [key, field] of Object.entries(fields)) {
    if ("attribute" in field)
      root.setAttribute(field.attribute, String(values[key]));
    else root.style.setProperty(field.property, `${values[key]}${field.unit}`);
  }
}

export function layoutBootstrapScript(definitions: LayoutDefinition[]) {
  function boot(
    definitions: LayoutDefinition[],
    parse: typeof parseLayout,
    project: typeof projectLayout,
  ) {
    for (const { key, fields } of definitions) {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        /* Storage may be blocked. */
      }
      project(fields, parse(fields, raw), document.documentElement);
    }
  }
  const data = JSON.stringify(definitions).replace(/</g, "\\u003c");
  return `(${boot.toString()})(${data},${parseLayout.toString()},${projectLayout.toString()});`;
}

/** One small store per layout definition. Native resizers should write on layout
 * completion, not on every pointer move. Snapshot identity is stable for React. */
export function createLocalLayout<T extends LayoutFields>(definition: {
  key: string;
  fields: T;
}) {
  type Values = LayoutValues<T>;
  const { key, fields } = definition;
  const defaults = parseLayout(fields, null) as Values;
  let current: Values | undefined;
  const listeners = new Set<() => void>();
  function read() {
    if (typeof window === "undefined") return defaults;
    if (!current) {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        /* Use defaults. */
      }
      current = parseLayout(fields, raw) as Values;
    }
    return current;
  }
  function project() {
    projectLayout(fields, read(), document.documentElement);
  }
  function storageChanged(event: StorageEvent) {
    if (event.key !== key && event.key !== null) return;
    current = undefined;
    project();
    for (const listener of listeners) listener();
  }
  function subscribe(listener: () => void) {
    if (!listeners.size) window.addEventListener("storage", storageChanged);
    listeners.add(listener);
    project();
    return () => {
      listeners.delete(listener);
      if (!listeners.size)
        window.removeEventListener("storage", storageChanged);
    };
  }
  function write(patch: Partial<Values>) {
    current = parseLayout(
      fields,
      JSON.stringify({ ...read(), ...patch }),
    ) as Values;
    try {
      localStorage.setItem(key, JSON.stringify(current));
    } catch {
      /* Keep in-memory layout usable. */
    }
    project();
    for (const listener of listeners) listener();
  }
  return {
    definition,
    defaults,
    read,
    write,
    subscribe,
    serverSnapshot: () => defaults,
  };
}
