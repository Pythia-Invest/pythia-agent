import type { PluginRequest, PluginTransport } from "@pythia/widget-sdk";
import { expect, it } from "vitest";
import type { SearchGroup, SearchRow } from "../src/search";
import { transportLookup } from "../src/search-ui/controller";

const row = (id: string, ticker: string): SearchRow => ({
  id,
  instrument: "security:isin:JP3633400001",
  ticker,
  name: "Toyota Motor Corp",
  kind: "ordinary",
  mic: "XLON",
  venue: "London Stock Exchange",
  country: "GB",
  currency: "USD",
});
const toyota: SearchGroup = {
  id: "security:isin:JP3633400001",
  name: "Toyota Motor Corp",
  kind: "ordinary",
  listings: 1,
  rows: [row("listing:figi:BBG000TYLND5", "TYT")],
};
const other: SearchGroup = {
  ...toyota,
  id: "security:isin:JP3633400002",
  rows: [row("listing:figi:BBG000TYXXX1", "OTH")],
};

/** A transport whose invoke answers core's `identity-lookup` and whose read
 * answers the directory search that follows it. */
function transport(lookup: unknown) {
  const calls: [string, PluginRequest][] = [];
  const value: PluginTransport = {
    invoke: async (request) => {
      calls.push(["invoke", request]);
      return lookup;
    },
    read: async (request) => {
      calls.push(["read", request]);
      return { outcome: "ok", data: { groups: [toyota, other], lookup: [] } };
    },
    updates: () => {
      throw Error("A lookup is one call.");
    },
  };
  return { value, calls };
}

const signal = new AbortController().signal;
const request = { plugin: "pythia-openfigi", query: "JP3633400001" };

it("looks the query up once, then answers the directory's groups holding what it placed", async () => {
  const { value, calls } = transport({
    outcome: "ok",
    data: { joined: 0, introduced: 1, subjects: ["listing:figi:BBG000TYLND5"] },
  });
  await expect(transportLookup(value)(request, signal)).resolves.toEqual([
    toyota,
  ]);
  expect(calls.map(([kind, sent]) => [kind, sent.operation])).toEqual([
    ["invoke", "identity-lookup"],
    ["read", "identity-search"],
  ]);
  expect(calls[0]?.[1]).toMatchObject({
    plugin: "pythia",
    arguments: request,
  });
});

it("answers no groups for no match, and fails when the lookup fails", async () => {
  const none = transport({
    outcome: "empty",
    data: { joined: 0, introduced: 0, subjects: [] },
    issues: [{ message: "OpenFIGI found no match." }],
  });
  await expect(transportLookup(none.value)(request, signal)).resolves.toEqual(
    [],
  );
  expect(none.calls).toHaveLength(1); // nothing placed: no directory read
  const failed = transport({
    outcome: "empty",
    data: null,
    issues: [{ message: "OpenFIGI lookup failed: no answer in time" }],
  });
  await expect(transportLookup(failed.value)(request, signal)).rejects.toThrow(
    "OpenFIGI lookup failed",
  );
});
