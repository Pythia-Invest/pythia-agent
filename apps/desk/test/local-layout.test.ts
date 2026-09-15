import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import {
  createLocalLayout,
  layoutBootstrapScript,
  parseLayout,
} from "@/layout/local-layout";

const definition = {
  key: "test-layout",
  fields: {
    open: { default: true, attribute: "data-test-open" },
    width: {
      default: 420,
      property: "--test-width",
      min: 340,
      max: 680,
      unit: "px" as const,
    },
  },
};
afterEach(() => vi.unstubAllGlobals());

it("validates saved values and bounds geometry", () => {
  expect(
    parseLayout(definition.fields, '{"open":"false","width":900,"extra":true}'),
  ).toEqual({ open: true, width: 680 });
  for (const raw of [null, "broken", "[]", "null"])
    expect(parseLayout(definition.fields, raw)).toEqual({
      open: true,
      width: 420,
    });
});

it("bootstraps independent layouts with the same validation, including blocked storage", () => {
  const values = new Map<string, string>();
  const root = {
    setAttribute: (key: string, value: string) => values.set(key, value),
    style: {
      setProperty: (key: string, value: string) => values.set(key, value),
    },
  };
  const second = {
    key: "other</script>",
    fields: { hidden: { default: false, attribute: "data-other-hidden" } },
  };
  const script = layoutBootstrapScript([definition, second]);
  expect(script).not.toContain("</script>");
  runInNewContext(script, {
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => {
        if (key === second.key) throw new Error("blocked");
        return '{"open":false,"width":610}';
      },
    },
  });
  expect(Object.fromEntries(values)).toEqual({
    "data-test-open": "false",
    "--test-width": "610px",
    "data-other-hidden": "false",
  });
});

it("keeps snapshots stable and partial updates usable when persistence fails", () => {
  const setItem = vi.fn(() => {
    throw new Error("blocked");
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: () => '{"open":false,"width":610}',
    setItem,
  });
  vi.stubGlobal("document", {
    documentElement: { setAttribute: vi.fn(), style: { setProperty: vi.fn() } },
  });
  const store = createLocalLayout(definition);
  expect(store.read()).toBe(store.read());
  expect(store.serverSnapshot()).toEqual({ open: true, width: 420 });
  store.write({ open: true });
  expect(store.read()).toEqual({ open: true, width: 610 });
  expect(setItem).toHaveBeenCalledTimes(1);
});

it("refreshes subscribers and root presentation when another tab changes storage", () => {
  const events = new EventTarget();
  let saved = '{"open":true,"width":420}';
  const setProperty = vi.fn();
  vi.stubGlobal("window", events);
  vi.stubGlobal("localStorage", { getItem: () => saved });
  vi.stubGlobal("document", {
    documentElement: { setAttribute: vi.fn(), style: { setProperty } },
  });
  const store = createLocalLayout(definition);
  const changed = vi.fn();
  const unsubscribe = store.subscribe(changed);
  saved = '{"open":false,"width":590}';
  const event = Object.assign(new Event("storage"), { key: definition.key });
  events.dispatchEvent(event);
  expect(store.read()).toEqual({ open: false, width: 590 });
  expect(setProperty).toHaveBeenLastCalledWith("--test-width", "590px");
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
  events.dispatchEvent(event);
  expect(changed).toHaveBeenCalledTimes(1);
});
