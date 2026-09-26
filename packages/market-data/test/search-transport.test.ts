import type { PluginRequest, PluginTransport } from "@pythia/widget-sdk";
import { describe, expect, it } from "vitest";
import { searchDemoDirectory } from "../src/search-demo";
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
const response = searchDemoDirectory("asml");

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

  it("rejects failed or malformed results instead of showing them", async () => {
    const failed = transport({ outcome: "error", issues: [] }).value;
    await expect(
      transportSearch(failed)({ query: "asml", limit: 20 }, signal),
    ).rejects.toThrow();
    const [group] = response.groups;
    const malformed = transport({
      outcome: "ok",
      data: { ...response, groups: [{ ...group, rows: [] }] },
    }).value;
    await expect(
      transportSearch(malformed)({ query: "asml", limit: 20 }, signal),
    ).rejects.toThrow();
  });
});
