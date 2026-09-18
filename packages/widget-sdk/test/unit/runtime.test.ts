import * as react from "react";
import * as reactDom from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { expect, test, vi } from "vitest";
import * as sdk from "../../src/index";
import { assertWidgetModule, type WidgetHost } from "../../src/runtime";

const host: WidgetHost = { react, reactDom, jsxRuntime, sdk };
function artifact() {
  return {
    metadata: {
      format: "pythia-widget-module",
      version: 1,
      runtimeVersion: 1,
      reactMajor: 19,
      sdkVersion: "0.1.0",
      scope: `pyw-${"a".repeat(24)}`,
      imports: { react: ["useState"], sdk: ["InstrumentTable"] },
    },
    css: "",
    createWidget: vi.fn(() => () => null),
  };
}

test("accepts the supported SDK ABI and actual runtime bindings without invoking author code", () => {
  const module = artifact();
  assertWidgetModule(module, host);
  expect(module.createWidget).not.toHaveBeenCalled();
});

test.each([
  { runtimeVersion: 2 },
  { version: 2 },
  { reactMajor: 18 },
  { imports: { sdk: ["FutureComponent"] } },
  { imports: { react: ["futureHook"] } },
  { imports: { arbitrary: ["execute"] } },
  { imports: { sdk: "InstrumentTable" } },
  { scope: 'bad"][data-host]' },
])("rejects incompatible modules before their factory runs: %o", (metadata) => {
  const module = artifact();
  Object.assign(module.metadata, metadata);
  expect(() => assertWidgetModule(module, host)).toThrow();
  expect(module.createWidget).not.toHaveBeenCalled();
});
