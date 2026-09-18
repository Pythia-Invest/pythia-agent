import * as React from "react";
import * as ReactDom from "react-dom";
import * as JsxRuntime from "react/jsx-runtime";
import * as WidgetSdk from "@pythia/widget-sdk";
import { expect, it, vi } from "vitest";
import {
  createWidgetModuleLoader,
  widgetModuleUrl,
} from "@/client/widget-modules";

const runtime = {
  react: React,
  reactDom: ReactDom,
  jsxRuntime: JsxRuntime,
  sdk: WidgetSdk,
};
const metadata = {
  format: "pythia-widget-module",
  version: 1,
  runtimeVersion: 1,
  reactMajor: 19,
  sdkVersion: "0.1.0",
  scope: "pyw-012345678901234567890123",
  imports: { react: ["useState"], sdk: ["InstrumentPrice"] },
};

it("shares one load and component definition between concurrent and later instances", async () => {
  const Component = () => null;
  const createWidget = vi.fn(() => ({ Component }));
  const imported = vi.fn(async () => ({ metadata, css: "", createWidget }));
  const load = createWidgetModuleLoader(runtime, imported);
  const first = load("http://localhost/widget?revision=1");
  expect(load("http://localhost/widget?revision=1")).toBe(first);
  expect((await first).Component).toBe(Component);
  expect((await load("http://localhost/widget?revision=1")).Component).toBe(
    Component,
  );
  expect(imported).toHaveBeenCalledTimes(1);
  expect(createWidget).toHaveBeenCalledExactlyOnceWith(runtime);
});

it("rejects incompatible requirements before author factory execution", async () => {
  const createWidget = vi.fn(() => ({ Component: () => null }));
  const load = createWidgetModuleLoader(runtime, async () => ({
    metadata: { ...metadata, runtimeVersion: 99 },
    css: "",
    createWidget,
  }));
  await expect(load("http://localhost/widget")).rejects.toThrow("incompatible");
  expect(createWidget).not.toHaveBeenCalled();
});

it("retries a failed browser identity while preserving the revision and shared successful factory", async () => {
  const createWidget = vi.fn(() => ({ Component: () => null }));
  const imported = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporarily unavailable"))
    .mockResolvedValue({ metadata, css: "", createWidget });
  const load = createWidgetModuleLoader(runtime, imported);
  const url = "http://localhost/widget?revision=abc";
  await expect(load(url)).rejects.toThrow("temporarily unavailable");
  const recovered = load(url);
  expect(load(url)).toBe(recovered);
  expect((await recovered).Component).toBeTypeOf("function");
  expect(load(url)).toBe(recovered);
  expect(imported.mock.calls.map(([url]) => url)).toEqual([
    url,
    `${url}&pythia-widget-attempt=1`,
  ]);
  expect(imported).toHaveBeenCalledTimes(2);
  expect(createWidget).toHaveBeenCalledTimes(1);
});

it("bounds failed browser module records instead of creating unlimited retry identities", async () => {
  const imported = vi.fn().mockRejectedValue(new Error("unavailable"));
  const load = createWidgetModuleLoader(runtime, imported);
  const url = "http://localhost/widget?revision=abc";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(load(url)).rejects.toThrow("unavailable");
  }
  await expect(load(url)).rejects.toThrow("three attempts");
  expect(imported.mock.calls.map(([url]) => url)).toEqual([
    url,
    `${url}&pythia-widget-attempt=1`,
    `${url}&pythia-widget-attempt=2`,
  ]);
});

it("accepts only same-origin HTTP module URLs and rejects fragment aliases", () => {
  for (const origin of [
    "http://localhost:43212",
    "https://desk.example.test",
  ]) {
    expect(widgetModuleUrl("/api/widgets/a?revision=b", origin)).toBe(
      `${origin}/api/widgets/a?revision=b`,
    );
    for (const value of [
      "https://other.test/a",
      "data:text/javascript,export{}",
      "/a#b",
    ]) {
      expect(() => widgetModuleUrl(value, origin)).toThrow("same-origin");
    }
  }
});
