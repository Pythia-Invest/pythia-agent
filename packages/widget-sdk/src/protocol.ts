import type {
  WidgetFrameMessage,
  WidgetProps,
  WidgetRenderMessage,
} from "./types";
export type {
  WidgetAppearance,
  WidgetFrameMessage,
  WidgetProps,
  WidgetRenderMessage,
  WidgetSnapshot,
  WidgetTheme,
} from "./types";
export {
  WIDGET_ARTIFACT_MARKER,
  MAX_WIDGET_ARTIFACT_BYTES,
} from "./artifact.mjs";
export const WIDGET_PROTOCOL_VERSION = 1;

/** Envelope validation only; the host owns the supplied domain data schema. */
export function isWidgetRenderMessage(
  value: unknown,
): value is WidgetRenderMessage<unknown> {
  const record = (input: unknown): input is Record<string, unknown> =>
    input !== null && typeof input === "object" && !Array.isArray(input);
  if (
    !record(value) ||
    value.type !== "pythia:render" ||
    value.version !== 1 ||
    !("data" in value) ||
    !record(value.options) ||
    !record(value.settings) ||
    !record(value.theme) ||
    typeof value.locale !== "string" ||
    value.locale.length > 100 ||
    typeof value.timeZone !== "string" ||
    value.timeZone.length > 100
  )
    return false;
  for (const key of ["foreground", "background", "up", "down"])
    if (typeof value.theme[key] !== "string" || value.theme[key].length > 256)
      return false;
  for (const key of [
    "book",
    "name",
    "note",
    "unit",
    "path",
    "range",
    "compact",
  ])
    if (
      value.options[key] !== undefined &&
      typeof value.options[key] !== "boolean"
    )
      return false;
  if (
    value.options.change !== undefined &&
    value.options.change !== "percent" &&
    value.options.change !== "absolute" &&
    value.options.change !== "both"
  )
    return false;
  if (
    value.options.pathHeight !== undefined &&
    (typeof value.options.pathHeight !== "number" ||
      !Number.isFinite(value.options.pathHeight))
  )
    return false;
  if (
    value.appearance !== undefined &&
    (!record(value.appearance) ||
      (value.appearance.theme !== "light" &&
        value.appearance.theme !== "dark") ||
      (value.appearance.profile !== "product" &&
        value.appearance.profile !== "public"))
  )
    return false;
  return true;
}

export function isWidgetFrameMessage(
  value: unknown,
): value is WidgetFrameMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const message = value as Record<string, unknown>;
  if (message.version !== undefined && message.version !== 1) return false;
  return (
    message.type === "pythia:ready" ||
    message.type === "pythia:error" ||
    (message.type === "pythia:height" &&
      typeof message.height === "number" &&
      Number.isFinite(message.height))
  );
}

/** Applies host presentation only, without reading parent DOM or local settings. */
export function applyWidgetAppearance(
  document: Pick<Document, "documentElement">,
  message: WidgetProps<unknown>,
) {
  const root = document.documentElement;
  for (const key of ["foreground", "background", "up", "down"] as const)
    root.style.setProperty(`--widget-${key}`, message.theme[key]);
  root.setAttribute("data-theme", message.appearance?.theme ?? "light");
  root.setAttribute(
    "data-pythia-profile",
    message.appearance?.profile ?? "product",
  );
  root.lang = message.locale;
}

// Literal browser code survives host minification without serialized function
// closures or compiler helpers. The bridge checks origin authority/version and
// the presentation envelope; SDK renderers further validate standard options.
const documentBridge = `(() => {
  let observer;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const notify = message => parent.postMessage(message, "*");
  const report = () => notify({ type: "pythia:error", version: 1 });
  const receive = event => {
    const message = event.data;
    if (event.source !== parent || !record(message) || message.type !== "pythia:render" || message.version !== 1 ||
        !("data" in message) || !record(message.options) || !record(message.settings) || !record(message.theme) ||
        typeof message.locale !== "string" || message.locale.length > 100 ||
        typeof message.timeZone !== "string" || message.timeZone.length > 100) return;
    const keys = ["foreground", "background", "up", "down"];
    if (keys.some(key => typeof message.theme[key] !== "string" || message.theme[key].length > 256)) return;
    const appearance = message.appearance;
    if (appearance !== undefined && (!record(appearance) ||
        (appearance.theme !== "light" && appearance.theme !== "dark") ||
        (appearance.profile !== "product" && appearance.profile !== "public"))) return;
    const root = document.documentElement;
    keys.forEach(key => root.style.setProperty("--widget-" + key, message.theme[key]));
    root.setAttribute("data-theme", appearance ? appearance.theme : "light");
    root.setAttribute("data-pythia-profile", appearance ? appearance.profile : "product");
    root.lang = message.locale;
    window.dispatchEvent(new CustomEvent("pythia:render", { detail: message }));
  };
  const ready = () => {
    notify({ type: "pythia:ready", version: 1 });
    observer = new ResizeObserver(() => notify({ type: "pythia:height", version: 1, height: document.body.scrollHeight }));
    observer.observe(document.body);
  };
  const dispose = () => {
    if (observer) observer.disconnect();
    window.removeEventListener("message", receive);
    window.removeEventListener("error", report);
    window.removeEventListener("unhandledrejection", report);
    window.removeEventListener("DOMContentLoaded", ready);
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("message", receive);
  window.addEventListener("error", report);
  window.addEventListener("unhandledrejection", report);
  window.addEventListener("DOMContentLoaded", ready, { once: true });
  window.addEventListener("pagehide", dispose, { once: true });
})();`;

/** Trusted authored bytes remain inside the existing opaque-origin iframe.
 * CSP precedes them; this wrapper gives no credential, fetch, file or tool bridge. */
export function customWidgetDocument(html: string) {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:12px system-ui;color:var(--widget-foreground);background:var(--widget-background)}*{box-sizing:border-box}</style><script>${documentBridge}</script></head><body>${html}</body></html>`;
}
