import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
import {
  customWidgetDocument,
  isWidgetFrameMessage,
  isWidgetRenderMessage,
  type WidgetRenderMessage,
} from "../../src/protocol";

const message: WidgetRenderMessage<{ measurement: number }> = {
  type: "pythia:render",
  version: 1,
  data: { measurement: 12 },
  options: { change: "both" },
  settings: { title: "Research" },
  theme: { foreground: "#111", background: "#fff", up: "green", down: "red" },
  locale: "nl-BE",
  timeZone: "Europe/Brussels",
  appearance: { theme: "dark", profile: "product" },
};

test("validates the v1 display envelope without claiming a financial data schema", () => {
  expect(isWidgetRenderMessage(message)).toBe(true);
  const { appearance: _appearance, ...legacy } = message;
  expect(isWidgetRenderMessage(legacy)).toBe(true);
  expect(
    isWidgetRenderMessage({ ...message, data: { anotherHostContract: true } }),
  ).toBe(true);
  for (const invalid of [
    null,
    { ...message, version: 2 },
    { ...message, settings: [] },
    { ...message, theme: { foreground: "#111" } },
    { ...message, appearance: { theme: "system", profile: "product" } },
    { ...message, options: { change: { toString: () => "both" } } },
    { ...message, options: { pathHeight: Infinity } },
  ])
    expect(isWidgetRenderMessage(invalid)).toBe(false);
});

test("accepts legacy iframe notifications but rejects unsupported versions and invalid heights", () => {
  expect(isWidgetFrameMessage({ type: "pythia:ready" })).toBe(true);
  expect(isWidgetFrameMessage({ type: "pythia:error", version: 1 })).toBe(true);
  expect(
    isWidgetFrameMessage({ type: "pythia:height", height: 280, version: 1 }),
  ).toBe(true);
  expect(isWidgetFrameMessage({ type: "pythia:ready", version: 2 })).toBe(
    false,
  );
  expect(isWidgetFrameMessage({ type: "pythia:height", height: NaN })).toBe(
    false,
  );
  expect(
    isWidgetFrameMessage({ type: "pythia:invoke", operation: "read" }),
  ).toBe(false);
});

function documentFrame() {
  const window = new EventTarget();
  const parent = { postMessage: vi.fn() };
  const attributes = new Map<string, string>();
  const document = {
    documentElement: {
      style: { setProperty: vi.fn() },
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      lang: "",
    },
    body: { scrollHeight: 160 },
  };
  const disconnect = vi.fn();
  let resized: (() => void) | undefined;
  class ResizeObserver {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {}
    disconnect = disconnect;
  }
  const html = customWidgetDocument("<main>Local content</main>");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error("No executable document bridge");
  runInNewContext(script, {
    window,
    parent,
    document,
    CustomEvent,
    ResizeObserver,
  });
  return {
    window,
    parent,
    document,
    attributes,
    disconnect,
    resize: () => resized?.(),
    deliver(data: unknown, source: unknown = parent) {
      window.dispatchEvent(
        Object.assign(new Event("message"), { data, source }),
      );
    },
  };
}

test("the shipped document bridge admits only its parent v1 envelope and applies appearance", () => {
  const frame = documentFrame();
  const render = vi.fn();
  frame.window.addEventListener("pythia:render", render);
  frame.deliver(message, {});
  frame.deliver({ ...message, version: 2 });
  frame.deliver({ ...message, theme: null });
  expect(render).not.toHaveBeenCalled();
  frame.deliver(message);
  expect(render).toHaveBeenCalledTimes(1);
  expect(
    (render.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail,
  ).toEqual(message);
  expect(frame.attributes.get("data-theme")).toBe("dark");
  expect(frame.attributes.get("data-pythia-profile")).toBe("product");
  expect(frame.document.documentElement.lang).toBe("nl-BE");
  frame.deliver({
    ...message,
    appearance: { theme: "light", profile: "public" },
  });
  expect(frame.attributes.get("data-theme")).toBe("light");
  expect(frame.attributes.get("data-pythia-profile")).toBe("public");
});

test("the document reports readiness, size and errors, then releases listeners on departure", () => {
  const frame = documentFrame();
  frame.window.dispatchEvent(new Event("DOMContentLoaded"));
  expect(frame.parent.postMessage).toHaveBeenLastCalledWith(
    { type: "pythia:ready", version: 1 },
    "*",
  );
  frame.resize();
  expect(frame.parent.postMessage).toHaveBeenLastCalledWith(
    { type: "pythia:height", version: 1, height: 160 },
    "*",
  );
  frame.window.dispatchEvent(new Event("error"));
  expect(frame.parent.postMessage).toHaveBeenLastCalledWith(
    { type: "pythia:error", version: 1 },
    "*",
  );
  frame.window.dispatchEvent(new Event("pagehide"));
  expect(frame.disconnect).toHaveBeenCalledOnce();
  frame.parent.postMessage.mockClear();
  const render = vi.fn();
  frame.window.addEventListener("pythia:render", render);
  frame.deliver(message);
  frame.window.dispatchEvent(new Event("unhandledrejection"));
  expect(render).not.toHaveBeenCalled();
  expect(frame.parent.postMessage).not.toHaveBeenCalled();
});
