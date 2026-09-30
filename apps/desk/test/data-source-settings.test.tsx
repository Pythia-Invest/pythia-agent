// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  dataSourceSchema,
  lookupSchema,
  syncSchema,
} from "@/client/data-sources";
import {
  DataSourceSettings,
  effectLine,
  syncLine,
} from "@/components/settings/data-sources";

const state = vi.hoisted(() => ({
  plugins: [] as unknown[],
  sync: null as unknown,
  found: null as unknown,
  lookup: vi.fn(),
  mutate: vi.fn(),
  pause: vi.fn(),
}));
vi.mock("@/client/data-sources", async (original) => {
  const actual = await original<typeof import("@/client/data-sources")>();
  return {
    ...actual,
    useDataSources: () => ({
      isPending: false,
      error: null,
      data: state.plugins.map((item) => actual.dataSourceSchema.parse(item)),
      refetch: vi.fn(),
    }),
    useSyncSource: () => ({
      isPending: false,
      error: null,
      data: state.sync,
      mutate: state.mutate,
    }),
    useLookupSource: () => ({
      isPending: false,
      error: null,
      data: state.found,
      mutate: state.lookup,
    }),
    usePauseSource: () => ({
      isPending: false,
      error: null,
      mutate: state.pause,
    }),
  };
});

// The rows core's `identity-plugin-effect` answers (plugin_effect.py).
const defi = {
  plugin: "pythia-defillama",
  label: "DeFiLlama",
  enabled: true,
  paused: false,
  catalogue: true,
  lookup: [],
  serves: [],
  sole: {
    count: 1204,
    sample: [{ id: "market:provisional:defillama:pool:P1", name: "USDC" }],
  },
  saved: {
    count: 1,
    sample: [
      {
        id: "market:provisional:defillama:pool:P1",
        name: "Navi USDC",
        setting: "markets_watchlist",
      },
    ],
  },
};
const lookup = {
  ...defi,
  plugin: "pythia-openfigi",
  label: "OpenFIGI",
  catalogue: false,
  lookup: ["isin"],
  sole: { count: 0, sample: [] },
  saved: { count: 0, sample: [] },
};

// A price and profile source supplies no subject of its own (Yahoo, EODHD,
// Hyperliquid): it still has a switch, and its effect is about its data.
const prices = {
  ...lookup,
  plugin: "pythia-yahoo-discovery",
  label: "Yahoo Finance",
  lookup: [],
  serves: ["market_data", "profile", "news"],
};

beforeEach(() => {
  state.plugins = [defi, lookup];
  state.sync = null;
  state.found = null;
  state.pause.mockReset();
  state.lookup.mockReset();
});

it("shows what turning each source off hides, beside its switch, and no trust level", () => {
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain("DeFiLlama");
  expect(html).not.toMatch(/Display only|Confirms identity/u);
  expect(html).toContain(
    "Turning this off hides 1204 subjects; 1 saved item will show as paused (Navi USDC).",
  );
  expect(html).toContain(
    "No subject on this device comes only from it, so turning this off hides none.",
  );
  expect(html.match(/role="switch"/gu)).toHaveLength(2);
  expect(html).toContain('aria-label="Use DeFiLlama"');
});

it("gives a price source a switch, and says its prices and news come from other sources", () => {
  state.plugins = [prices];
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain('aria-label="Use Yahoo Finance"');
  expect(html).toContain(
    "Turning this off stops its prices, profiles and news; other sources take over where configured.",
  );
  expect(html).not.toContain("hides none");
  state.plugins = [{ ...prices, enabled: false, paused: true }];
  expect(renderToStaticMarkup(<DataSourceSettings />)).toContain(
    "It is not used for prices, profiles and news now; other sources take over where configured.",
  );
  const both = dataSourceSchema.parse({ ...defi, serves: ["market_data"] });
  expect(effectLine(both)).toBe(
    "Turning this off hides 1204 subjects; 1 saved item will show as paused (Navi USDC). It also stops its prices; other sources take over where configured.",
  );
});

it("says a source Hermes has not enabled needs Hermes's command and a restart", () => {
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain("hermes plugins enable");
  expect(html).toContain("restart");
});

it("shows a paused source as off, with what stays hidden, and no Sync now", () => {
  state.plugins = [{ ...defi, enabled: false, paused: true }];
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain("Paused");
  expect(html).toContain(
    "1204 subjects only it supplies are hidden, and 1 saved item shows as paused (Navi USDC).",
  );
  expect(html).toContain("Turn it back on to use it again.");
  expect(html).not.toContain("Sync now");
  expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/u);
});

it("pauses an on source and resumes a paused one from its switch", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  const toggle = async () => {
    const control = host.querySelector<HTMLElement>('[role="switch"]');
    await act(async () => control?.click());
  };
  state.plugins = [defi];
  await act(async () => root.render(<DataSourceSettings />));
  await toggle();
  expect(state.pause).toHaveBeenLastCalledWith({
    plugin: "pythia-defillama",
    paused: true,
  });
  state.plugins = [{ ...defi, paused: true }];
  await act(async () => root.render(<DataSourceSettings />));
  await toggle();
  expect(state.pause).toHaveBeenLastCalledWith({
    plugin: "pythia-defillama",
    paused: false,
  });
  await act(async () => root.unmount());
});

it("offers Sync now only for a plugin with a catalogue", () => {
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html.match(/Sync now/gu)).toHaveLength(1);
  state.plugins = [lookup];
  expect(renderToStaticMarkup(<DataSourceSettings />)).not.toContain(
    "Sync now",
  );
});

it("shows what a sync placed, and why it stopped", () => {
  state.plugins = [defi];
  state.sync = {
    summary: syncSchema.parse({
      joined: 3,
      introduced: 2,
      conflicts: 1,
      unmatched: 4,
      rejected: 0,
      not_seen: 0,
      pages: 50,
      partial: true,
    }),
    issue: "DeFiLlama's catalogue stopped: no answer in time",
  };
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain(
    "Read: 3 joined, 2 new, 1 conflict, 4 unmatched (stopped before the end). DeFiLlama&#x27;s catalogue stopped",
  );
});

it("puts a plugin's own lookup on its row, only while it is on, and never anywhere else", () => {
  const html = renderToStaticMarkup(<DataSourceSettings />);
  // OpenFIGI takes an ISIN; DeFiLlama has no resolve, so no form.
  expect(html.match(/data-slot="source-lookup"/gu)).toHaveLength(1);
  expect(html).toContain('aria-label="Look up ISIN in OpenFIGI"');
  state.plugins = [{ ...lookup, enabled: false, paused: true }];
  expect(renderToStaticMarkup(<DataSourceSettings />)).not.toContain(
    "source-lookup",
  );
});

it("sends the typed identifier to that plugin alone and shows how its records were placed", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  state.plugins = [defi, lookup];
  state.found = {
    summary: lookupSchema.parse({
      joined: 1,
      introduced: 2,
      conflicts: 0,
      unmatched: 0,
      rejected: 0,
      subjects: ["listing:figi:BBG000A", "listing:figi:BBG000B"],
    }),
    issue: null,
  };
  await act(async () => root.render(<DataSourceSettings />));
  const input = host.querySelector<HTMLInputElement>(
    'input[aria-label="Look up ISIN in OpenFIGI"]',
  );
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, " NL0010273215 ");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-slot="source-lookup"] form')
      ?.requestSubmit(),
  );
  expect(state.lookup).toHaveBeenCalledExactlyOnceWith({
    plugin: "pythia-openfigi",
    query: "NL0010273215",
  });
  const answer = host.querySelector(
    '[data-slot="source-lookup"] [role="status"]',
  );
  expect(answer?.textContent).toBe(
    "Stored: 1 joined, 2 new, 0 conflicts, 0 unmatched. Placed on listing:figi:BBG000A, listing:figi:BBG000B.",
  );
  expect(answer?.querySelector("a")?.getAttribute("href")).toBe(
    "/instrument/listing%3Afigi%3ABBG000A",
  );
  // A lookup whose every record was refused says so, not "Stored: 0 ...".
  state.found = {
    summary: lookupSchema.parse({
      joined: 0,
      introduced: 0,
      conflicts: 0,
      unmatched: 0,
      rejected: 2,
      subjects: [],
    }),
    issue: null,
  };
  await act(async () => root.render(<DataSourceSettings />));
  expect(
    host.querySelector('[data-slot="source-lookup"] [role="status"]')
      ?.textContent,
  ).toBe("Stored: 0 joined, 0 new, 0 conflicts, 0 unmatched, 2 rejected.");
  // No match is an answer with no counts, and says why.
  state.found = {
    summary: lookupSchema.parse({
      joined: 0,
      introduced: 0,
      conflicts: 0,
      unmatched: 0,
      subjects: [],
    }),
    issue: "OpenFIGI found no match.",
  };
  await act(async () => root.render(<DataSourceSettings />));
  expect(
    host.querySelector('[data-slot="source-lookup"] [role="status"]')
      ?.textContent,
  ).toBe("OpenFIGI found no match.");
  await act(async () => root.unmount());
});

it("lists the saved entries it names, and says when there are more", () => {
  const source = dataSourceSchema.parse({
    ...defi,
    sole: { count: 9, sample: [] },
    saved: {
      count: 7,
      sample: [{ id: "listing:figi:X", name: null, setting: "markets_cards" }],
    },
  });
  expect(effectLine(source)).toBe(
    "Turning this off hides 9 subjects; 7 saved items will show as paused (listing:figi:X, …).",
  );
  expect(effectLine({ ...source, sole: { count: 1, sample: [] } })).toContain(
    "hides 1 subject;",
  );
  expect(
    syncLine(
      syncSchema.parse({
        joined: 0,
        introduced: 0,
        conflicts: 2,
        unmatched: 0,
        not_seen: 5,
      }),
    ),
  ).toBe(
    "Read: 0 joined, 0 new, 2 conflicts, 0 unmatched, 5 no longer offered.",
  );
});
