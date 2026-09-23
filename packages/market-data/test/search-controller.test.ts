import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { DataUpdate } from "@pythia/widget-sdk";
import { searchSettingsSchema } from "../src/search-ui/settings";
import { expect, it, vi } from "vitest";
import {
  adoptInvestment,
  investmentSearchKey,
  investmentSearchOptions,
  searchProviders,
  searchSourcesOptions,
  releaseInvestmentSearch,
  type SearchTransport,
} from "../src/search-ui/controller";
import type { InvestmentSearchResult } from "../src/search";

const retained: InvestmentSearchResult = {
  id: "retained",
  subject: { kind: "listing", id: "saved" },
  name: "Saved company",
  symbol: "SAVED",
  kind: "listing",
  category: "equity",
  currency: "USD",
  venue: "XNAS",
  identity_status: "unresolved",
  references: [
    {
      native_ref: {
        provider: "removed",
        native_id: "SAVED",
        native_scope: "listing",
      },
      name: "Saved company",
      symbol: "SAVED",
      kind: "listing",
      status: "unresolved",
      available: false,
    },
  ],
};
const response = {
  schema_version: 1,
  outcome: "ok",
  data: { results: [retained], coverage: [], truncated: false },
  issues: [],
};
function snapshot(data: unknown): DataUpdate {
  return {
    schema_version: 1,
    index: 0,
    generation: "synthetic",
    revision: 1,
    type: "snapshot",
    state: "ready",
    data,
  };
}
function fixture() {
  const read = vi.fn<SearchTransport["read"]>(async () => ({
    search_sources: ["disabled", "live", "removed"],
  }));
  const invoke = vi.fn<SearchTransport["invoke"]>(async () => ({}));
  const updates = vi.fn<SearchTransport["updates"]>(async function* () {
    yield snapshot({ progress: [], result: response });
  });
  return {
    transport: { read, invoke, updates },
    read,
    invoke,
    updates,
  };
}

it("default discovery includes retained unavailable labels even without a live source", async () => {
  const { transport, read, updates, invoke } = fixture();
  const sources = await searchSourcesOptions(transport).queryFn({
    signal: new AbortController().signal,
  });
  expect(sources).toEqual(["disabled", "live", "removed"]);
  for (const inventory of [undefined, [], sources]) {
    const providers = searchProviders(inventory, []);
    const options = investmentSearchOptions(transport, "SAVED", providers);
    const result = await options.queryFn({
      signal: new AbortController().signal,
    });
    expect(result.data.results[0]?.references[0]?.available).toBe(false);
    const call = updates.mock.calls.at(-1);
    expect(call?.[0][0]?.arguments).not.toHaveProperty("providers");
  }
  expect(read).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

it("explicit exclusions include disabled/retained sources and distinguish empty from default", async () => {
  const { transport, updates } = fixture();
  const providers = searchProviders(["disabled", "live", "removed"], ["live"]);
  expect(providers).toEqual(["disabled", "removed"]);
  const empty = searchProviders(["removed"], ["removed"]);
  expect(empty).toEqual([]);
  await investmentSearchOptions(transport, "SAVED", empty).queryFn({
    signal: new AbortController().signal,
  });
  expect(updates.mock.calls[0]?.[0][0]?.arguments).toHaveProperty(
    "providers",
    [],
  );
  expect(investmentSearchOptions(transport, "SAVED").queryKey).not.toEqual(
    investmentSearchOptions(transport, "SAVED", empty).queryKey,
  );
});

it("reopening reuses fresh snapshots while changed filters and settings invalidation read again", async () => {
  const { transport, updates } = fixture();
  const cache = new QueryClient();
  try {
    await cache.fetchQuery(investmentSearchOptions(transport, "SAVED"));
    await cache.fetchQuery(investmentSearchOptions(transport, "SAVED"));
    expect(updates).toHaveBeenCalledTimes(1);
    await cache.fetchQuery(
      investmentSearchOptions(transport, "SAVED", ["removed"]),
    );
    expect(updates).toHaveBeenCalledTimes(2);
    cache.removeQueries({ queryKey: ["plugin"] });
    await cache.fetchQuery(investmentSearchOptions(transport, "SAVED"));
    expect(updates).toHaveBeenCalledTimes(3);
  } finally {
    cache.clear();
  }
});

it("publishes cumulative progress but never a partial candidate snapshot", async () => {
  const { transport: fixtureTransport } = fixture();
  const transport: SearchTransport = fixtureTransport;
  const progress = vi.fn();
  transport.updates = async function* () {
    yield snapshot({
      progress: [{ provider: "live", status: "ok", elapsed_ms: 10 }],
    });
    yield snapshot({ progress: [], result: response });
  };
  expect(
    await investmentSearchOptions(
      transport,
      "SAVED",
      undefined,
      progress,
    ).queryFn({ signal: new AbortController().signal }),
  ).toEqual(response);
  expect(progress.mock.calls).toEqual([
    [[]],
    [[{ provider: "live", status: "ok", elapsed_ms: 10 }]],
    [[]],
  ]);
});

it("cancellation releases update demand and a late snapshot cannot enter the cache", async () => {
  const { transport: fixtureTransport } = fixture();
  const transport: SearchTransport = fixtureTransport;
  let released = false;
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  transport.updates = async function* (_resources, signal) {
    try {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        started();
      });
      yield snapshot({ progress: [], result: response });
    } finally {
      released = true;
    }
  };
  const cache = new QueryClient();
  try {
    const query = cache
      .fetchQuery(investmentSearchOptions(transport, "SAVED"))
      .catch(() => undefined);
    await running;
    await cache.cancelQueries({ queryKey: investmentSearchKey });
    await query;
    await Promise.resolve();
    expect(released).toBe(true);
    expect(
      cache.getQueryData(investmentSearchOptions(transport, "SAVED").queryKey),
    ).toBeUndefined();
  } finally {
    cache.clear();
  }
});

it("selection invokes only source-bound adoption and keeps native error qualifications", async () => {
  const { transport, invoke, read, updates } = fixture();
  const unavailable = retained.references[0];
  if (!unavailable) throw Error("Missing retained reference.");
  const reference = { ...unavailable, available: true };
  invoke.mockResolvedValue({
    schema_version: 1,
    outcome: "ok",
    effect: "local_write",
    data: {
      subject: retained.subject,
      binding: reference.native_ref,
      identity_status: "unresolved",
      mapping_id: "mapping",
    },
    issues: [],
  });
  await adoptInvestment(transport, reference, "listing");
  expect(invoke).toHaveBeenCalledWith({
    plugin: "pythia-market-data",
    operation: "query",
    arguments: {
      action: "adopt_search",
      native_ref: reference.native_ref,
      scope: "listing",
      binding_mode: "source",
    },
  });
  expect(read).not.toHaveBeenCalled();
  expect(updates).not.toHaveBeenCalled();
  invoke.mockResolvedValue({
    outcome: "error",
    issues: [
      { message: "Details incomplete." },
      { message: "No identity was selected." },
    ],
  });
  await expect(
    adoptInvestment(transport, reference, "listing"),
  ).rejects.toThrow("Details incomplete. No identity was selected.");
  await expect(
    adoptInvestment(transport, unavailable, "listing"),
  ).rejects.toThrow("source is unavailable");
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("validates feature settings and preserves explicit empty exclusions", () => {
  expect(searchSettingsSchema.parse({})).toEqual({ excludedProviders: [] });
  expect(
    searchSettingsSchema.parse({ excludedProviders: ["disabled"] }),
  ).toEqual({ excludedProviders: ["disabled"] });
  expect(
    searchSettingsSchema.safeParse({ excludedProviders: [""] }).success,
  ).toBe(false);
  expect(
    searchSettingsSchema.safeParse({ excludedProviders: "disabled" }).success,
  ).toBe(false);
  expect(searchSettingsSchema.safeParse({ provider: "disabled" }).success).toBe(
    false,
  );
});

it("closing one consumer preserves another consumer's demand until the last closes", async () => {
  const { transport: base } = fixture();
  let signal: AbortSignal | undefined;
  const transport: SearchTransport = {
    ...base,
    updates: async function* (_resources, pending) {
      signal = pending;
      await new Promise<void>((resolve) =>
        pending.addEventListener("abort", () => resolve(), { once: true }),
      );
      yield snapshot({ progress: [], result: response });
    },
  };
  const cache = new QueryClient();
  const options = investmentSearchOptions(transport, "SAVED");
  const first = new QueryObserver(cache, options);
  const second = new QueryObserver(cache, options);
  const stopFirst = first.subscribe(() => {});
  const stopSecond = second.subscribe(() => {});
  try {
    stopFirst();
    await releaseInvestmentSearch(cache, "SAVED");
    expect(signal?.aborted).toBe(false);
    second.setOptions({ ...options, enabled: false });
    await releaseInvestmentSearch(cache, "SAVED");
    expect(signal?.aborted).toBe(true);
    expect(cache.getQueryData(options.queryKey)).toBeUndefined();
  } finally {
    stopFirst();
    stopSecond();
    cache.clear();
  }
});
