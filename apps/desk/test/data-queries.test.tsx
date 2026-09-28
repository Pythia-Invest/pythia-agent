// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { DeskApi } from "../src/client/api";
import type { DataResource, DataUpdate } from "../src/client/data-protocol";
import { type DataQuery, useDataQueries } from "../src/client/data-queries";
import { dataUpdates } from "../src/client/data-updates";

const api = { dataUpdates: vi.fn() } as unknown as DeskApi;
vi.mock("../src/client/providers", () => ({ useDeskApi: () => api }));

const resource = (symbol: string): DataResource => ({
  plugin: "synthetic-plugin",
  operation: "synthetic",
  arguments: { symbol },
});
const query = (symbol: string): DataQuery<unknown> => ({
  key: ["synthetic", symbol],
  resource: resource(symbol),
  enabled: true,
  decode: (value) => value,
});

afterEach(() => vi.clearAllMocks());

test("a resource kept across a spec change keeps its data; unmount releases demand", async () => {
  // jsdom reports a hidden page, which suspends demand.
  Object.defineProperty(document, "hidden", { value: false });
  // Each stream answers every resource once, then stays open.
  vi.mocked(api.dataUpdates).mockImplementation(async function* (
    resources: DataResource[],
    signal: AbortSignal,
  ) {
    for (const [index, item] of resources.entries())
      yield {
        schema_version: 1,
        index,
        generation: "one",
        revision: 1,
        type: "snapshot",
        state: "ready",
        data: item.arguments.symbol,
      } satisfies DataUpdate;
    await new Promise((resolve) =>
      signal.addEventListener("abort", resolve, { once: true }),
    );
  });
  const seen: unknown[][] = [];
  function Probe({ specs }: { specs: DataQuery<unknown>[] }) {
    seen.push(useDataQueries(specs).map((result) => result.data));
    return null;
  }
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  // Updates arrive from the data channel's own timers, outside act().
  const render = (specs: DataQuery<unknown>[]) =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe specs={specs} />
      </QueryClientProvider>,
    );
  render([query("A")]);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["A"]));
  const before = seen.length;
  render([query("B"), query("A")]);
  await vi.waitFor(() => expect(seen.at(-1)).toEqual(["B", "A"]));
  // A never went back to loading while B was added.
  expect(seen.slice(before).every((data) => data[1] === "A")).toBe(true);
  expect(dataUpdates(api).hasPublication(resource("A"))).toBe(true);
  root.unmount();
  expect(dataUpdates(api).hasPublication(resource("A"))).toBe(false);
  expect(dataUpdates(api).hasPublication(resource("B"))).toBe(false);
});
