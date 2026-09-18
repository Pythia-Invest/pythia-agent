import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountWidget } from "../../src/mount";

const renderer = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
const createRoot = vi.hoisted(() => vi.fn(() => renderer));
vi.mock("react-dom/client", () => ({ createRoot }));

const message = {
  type: "pythia:render",
  version: 1,
  data: { rows: [] },
  options: {},
  settings: {},
  theme: { foreground: "#111", background: "#fff", up: "green", down: "red" },
  locale: "en-US",
  timeZone: "UTC",
};
let window: EventTarget;
let removed: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  window = new EventTarget();
  removed = vi.fn();
  vi.stubGlobal(
    "window",
    Object.assign(window, { parent: { postMessage: vi.fn() } }),
  );
  vi.stubGlobal("document", {
    createElement: () => ({ setAttribute: vi.fn(), remove: removed }),
    body: { appendChild: vi.fn() },
    documentElement: { style: { setProperty: vi.fn() }, setAttribute: vi.fn() },
  });
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.unstubAllGlobals();
});

test("reuses a React root across valid updates and stops accepting data after disposal", () => {
  const mounted = mountWidget(() => null);
  window.dispatchEvent(
    new CustomEvent("pythia:render", { detail: { ...message, version: 2 } }),
  );
  expect(renderer.render).not.toHaveBeenCalled();
  window.dispatchEvent(new CustomEvent("pythia:render", { detail: message }));
  window.dispatchEvent(
    new CustomEvent("pythia:render", {
      detail: { ...message, settings: { expanded: true } },
    }),
  );
  expect(createRoot).toHaveBeenCalledOnce();
  expect(renderer.render).toHaveBeenCalledTimes(2);
  mounted.dispose();
  mounted.dispose();
  window.dispatchEvent(new CustomEvent("pythia:render", { detail: message }));
  expect(renderer.render).toHaveBeenCalledTimes(2);
  expect(renderer.unmount).toHaveBeenCalledOnce();
  expect(removed).toHaveBeenCalledOnce();
});

test("mounting another composition releases the previous frame root", () => {
  mountWidget(() => null);
  mountWidget(() => null);
  expect(renderer.unmount).toHaveBeenCalledOnce();
  window.dispatchEvent(new CustomEvent("pythia:render", { detail: message }));
  expect(renderer.render).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("pagehide"));
  expect(renderer.unmount).toHaveBeenCalledTimes(2);
});
