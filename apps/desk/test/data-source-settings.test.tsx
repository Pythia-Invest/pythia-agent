import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { dataSourceSchema, syncSchema } from "@/client/data-sources";
import {
  DataSourceSettings,
  effectLine,
  syncLine,
} from "@/components/settings/data-sources";

const state = vi.hoisted(() => ({
  plugins: [] as unknown[],
  sync: null as unknown,
  mutate: vi.fn(),
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
  };
});

// The rows core's `identity-plugin-effect` answers (plugin_effect.py).
const defi = {
  plugin: "pythia-defillama",
  label: "DeFiLlama",
  enabled: true,
  level: "display",
  catalogue: true,
  resolve: false,
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
  level: "confirm",
  catalogue: false,
  resolve: true,
  sole: { count: 0, sample: [] },
  saved: { count: 0, sample: [] },
};

beforeEach(() => {
  state.plugins = [defi, lookup];
  state.sync = null;
});

it("shows each source's trust level and what disabling it would take away", () => {
  const html = renderToStaticMarkup(<DataSourceSettings />);
  expect(html).toContain("DeFiLlama");
  expect(html).toContain("Display only");
  expect(html).toContain(
    "Disabling it takes 1204 subjects only it supplies out of search and data, including one on your watchlist or cards (Navi USDC), which keeps its name.",
  );
  expect(html).toContain("hermes plugins disable pythia-defillama");
  expect(html).toContain("Confirms identity");
  expect(html).toContain("No subject on this device comes only from it.");
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
    "Disabling it takes 9 subjects only it supplies out of search and data, including 7 on your watchlist or cards (listing:figi:X, …), which keep their names.",
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
