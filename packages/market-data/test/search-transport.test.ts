import type { PluginRequest, PluginTransport } from "@pythia/widget-sdk";
import { describe, expect, it } from "vitest";
import type { SearchResponse } from "../src/search";
import { transportSearch } from "../src/search-ui/controller";

function transport(reply: unknown) {
  const requests: PluginRequest[] = [];
  const value: PluginTransport = {
    read: async (request) => {
      requests.push(request);
      return reply;
    },
    invoke: async () => {
      throw Error("Search never mutates.");
    },
    updates: () => {
      throw Error("Search is a single read.");
    },
  };
  return { value, requests };
}

const signal = new AbortController().signal;
const response: SearchResponse = {
  groups: [
    {
      id: "issuer:lei:724500Y6DUVHQD6OXN27",
      name: "ASML Holding N.V.",
      kind: "ordinary",
      listings: 1,
      rows: [
        {
          id: "listing:isin:NL0010273215:XAMS:EUR",
          instrument: "security:isin:NL0010273215",
          ticker: "ASML",
          name: "ASML Holding N.V.",
          kind: "ordinary",
          mic: "XAMS",
          venue: "Euronext Amsterdam",
          country: "NL",
          currency: "EUR",
        },
      ],
    },
  ],
};

describe("search transport", () => {
  it("reads the local directory without reaching a provider search", async () => {
    const { value, requests } = transport({ outcome: "ok", data: response });
    await expect(
      transportSearch(value)({ query: "asml", limit: 20 }, signal),
    ).resolves.toEqual(response);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.arguments).not.toHaveProperty("provider");
    // `search` is the feature's provider search, which calls connectors.
    expect(requests[0]?.arguments).not.toMatchObject({ action: "search" });
  });

  it("passes a group read through as the same core operation", async () => {
    const { value, requests } = transport({ outcome: "ok", data: response });
    await transportSearch(value)(
      { query: "asml", group: "issuer:lei:724500Y6DUVHQD6OXN27", limit: 1 },
      signal,
    );
    expect(requests[0]).toMatchObject({
      plugin: "pythia",
      operation: "identity-search",
      arguments: { group: "issuer:lei:724500Y6DUVHQD6OXN27" },
    });
  });

  it("accepts a subject a plugin introduced: its own kind, no ticker, the plugin's label", async () => {
    const pool = {
      id: "market:provisional:defillama:pool:usdc-navi",
      instrument: "market:provisional:defillama:pool:usdc-navi",
      ticker: null,
      name: "NAVI Lending USDC",
      kind: "market",
      mic: null,
      venue: null,
      country: null,
      currency: null,
      source: "DefiLlama",
    } as const;
    const found: SearchResponse = {
      groups: [
        {
          id: pool.id,
          name: pool.name,
          kind: "market",
          listings: 1,
          rows: [pool],
        },
        {
          id: "protocol:provisional:defillama:protocol:navi",
          name: "NAVI",
          kind: "protocol",
          listings: 1,
          rows: [
            {
              ...pool,
              id: "protocol:provisional:defillama:protocol:navi",
              instrument: "protocol:provisional:defillama:protocol:navi",
              name: "NAVI",
              kind: "protocol",
            },
          ],
        },
      ],
    };
    const { value } = transport({ outcome: "ok", data: found });
    await expect(
      transportSearch(value)({ query: "navi", limit: 20 }, signal),
    ).resolves.toEqual(found);
  });

  it("passes the delisted filter through and accepts a delisted line", async () => {
    const [group] = response.groups;
    const [line] = group?.rows ?? [];
    const found: SearchResponse = {
      groups: [
        {
          ...group,
          rows: [{ ...line, ticker: null, delisted: true, no_ticker: true }],
        },
      ],
    } as SearchResponse;
    const { value, requests } = transport({ outcome: "ok", data: found });
    await expect(
      transportSearch(value)(
        { query: "asml", limit: 20, include_delisted: false },
        signal,
      ),
    ).resolves.toEqual(found);
    expect(requests[0]?.arguments).toMatchObject({ include_delisted: false });
  });

  it("rejects failed or malformed results instead of showing them", async () => {
    const failed = transport({ outcome: "error", issues: [] }).value;
    await expect(
      transportSearch(failed)({ query: "asml", limit: 20 }, signal),
    ).rejects.toThrow();
    const [group] = response.groups;
    const malformed = transport({
      outcome: "ok",
      data: { ...response, groups: [{ ...group, listings: 0 }] },
    }).value;
    await expect(
      transportSearch(malformed)({ query: "asml", limit: 20 }, signal),
    ).rejects.toThrow();
  });
});
