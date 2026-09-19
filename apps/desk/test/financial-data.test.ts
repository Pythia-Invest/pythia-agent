import { requiredFixture } from "./required-fixture";
import { describe, expect, it, vi } from "vitest";
import examples from "../../../packages/market-data/examples/valid.json";
import type { ReadInput } from "@pythia/market-data";
import { createFinancialDataService } from "../src/server/financial-data";
import { readResultSchema } from "@pythia/market-data/widgets/contract";

const fixture = () =>
  readResultSchema.parse(
    requiredFixture(
      examples.find((item) => item.name === "latest_unknown_time"),
    ).value,
  );
function input(id: string): ReadInput {
  const request = fixture().request;
  request.view = {
    kind: "pythia",
    subject: { kind: "crypto", id: `crypto:${id}` },
  };
  return { request, criteria: { measurement: "aggregate_price" } };
}
describe("shared financial reads", () => {
  it("detaches cancelled Desk callers and aborts only batches without consumers", async () => {
    vi.useFakeTimers();
    try {
      let upstream: AbortSignal | undefined;
      let release: (() => void) | undefined;
      let calls = 0;
      const service = createFinancialDataService(
        { NODE_ENV: "test" },
        async (call, signal) => {
          expect(call).toMatchObject({
            plugin: "pythia-market-data",
            operation: "query",
          });
          calls++;
          upstream = signal;
          await new Promise<void>((resolve, reject) => {
            release = resolve;
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
          const reads = (call.arguments as { reads: ReadInput[] }).reads;
          return JSON.stringify({
            schema_version: 1,
            outcome: "ok",
            data: reads.map((read) => ({
              ...fixture(),
              request: read.request,
            })),
          });
        },
      );
      const first = new AbortController(),
        second = new AbortController();
      const leaving = service.read({ reads: [input("one")] }, first.signal);
      const rejected = expect(leaving).rejects.toThrow();
      const staying = service.read(
        { reads: [input("one"), input("two")] },
        second.signal,
      );
      await vi.advanceTimersByTimeAsync(5);
      first.abort();
      await rejected;
      expect(upstream?.aborted).toBe(false);
      release?.();
      expect(await staying).toHaveLength(2);
      expect(calls).toBe(1);
      const last = new AbortController();
      const abandoned = service.read({ reads: [input("three")] }, last.signal);
      const cancelled = expect(abandoned).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5);
      last.abort();
      await cancelled;
      expect(upstream?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("coordinates overlapping lists and revalidates cache custody before reuse", async () => {
    const calls: { reads: ReadInput[]; reuse?: string }[] = [];
    let scope = "a".repeat(64),
      fail = false;
    const now = Date.parse("2026-01-05T12:00:00Z");
    const service = createFinancialDataService(
      { PYTHIA_HERMES_PROFILE: "synthetic", NODE_ENV: "test" },
      async (args) => {
        const request = args.arguments as { reads: ReadInput[] };
        const reuse = args.reuseScope;
        calls.push({ reads: request.reads, ...(reuse ? { reuse } : {}) });
        if (fail)
          return JSON.stringify({
            schema_version: 1,
            outcome: "error",
            issues: [{ code: "unavailable" }],
          });
        if (reuse === scope)
          return JSON.stringify({ schema_version: 1, reuse: scope });
        return JSON.stringify({
          schema_version: 1,
          outcome: "ok",
          data: request.reads.map((item: ReadInput) => {
            const result = fixture();
            result.request = item.request;
            result.selection.view = item.request.view;
            if (item.request.view.kind === "pythia")
              requiredFixture(result.series).subject =
                item.request.view.subject;
            result.retrieved_at = new Date(now).toISOString();
            return result;
          }),
          delivery: {
            reuse_scope: scope,
            max_age_seconds: request.reads.map(() => 60),
          },
        });
      },
      () => now,
    );
    const signal = new AbortController().signal;
    const a = input("first"),
      b = input("second"),
      c = input("third");
    const [left, right] = await Promise.all([
      service.read({ reads: [a, b] }, signal),
      service.read({ reads: [b, c] }, signal),
    ]);
    expect(calls).toHaveLength(1);
    expect(requiredFixture(calls[0]).reads).toHaveLength(3);
    expect(left[1]).toEqual(right[0]);
    await service.read({ reads: [b] }, signal);
    expect(requiredFixture(calls[1]).reuse).toBe(scope);
    scope = "b".repeat(64);
    await service.read({ reads: [a, b] }, signal);
    expect(requiredFixture(calls[2]).reuse).toBe("a".repeat(64));
    fail = true;
    await expect(service.read({ reads: [a] }, signal)).rejects.toThrow();
  });
});

it("failed native reads never become reusable cache entries even with a supplied age", async () => {
  const scopes: (string | undefined)[] = [];
  const failure = readResultSchema.parse(
    requiredFixture(examples.find((item) => item.name === "unavailable")).value,
  );
  const now = Date.parse(failure.retrieved_at);
  const service = createFinancialDataService(
    { NODE_ENV: "test" },
    async (call) => {
      scopes.push(call.reuseScope);
      const reads = (call.arguments as { reads: ReadInput[] }).reads;
      return JSON.stringify({
        schema_version: 1,
        outcome: "ok",
        data: reads.map((read) => ({ ...failure, request: read.request })),
        delivery: {
          max_age_seconds: reads.map(() => 60),
          reuse_scope: "b".repeat(64),
        },
      });
    },
    () => now,
  );
  const signal = new AbortController().signal;
  await service.read({ reads: [input("failed")] }, signal);
  await service.read({ reads: [input("failed")] }, signal);
  expect(scopes).toEqual([undefined, undefined]);
});

it("preference revision adapters reject malformed native revisions and preserve read-only authority", async () => {
  for (const value of [
    { outcome: "ok", data: { revision: 1 } },
    { schema_version: 1, outcome: "ok", data: { revision: -1 } },
    { schema_version: 1, outcome: "ok", data: { revision: 1.5 } },
  ]) {
    const service = createFinancialDataService(
      { NODE_ENV: "test" },
      async (call) => {
        expect(call).toMatchObject({
          readOnly: true,
          arguments: { action: "get_preferences" },
        });
        return JSON.stringify(value);
      },
    );
    await expect(
      service.preferences(new AbortController().signal),
    ).rejects.toThrow("preferences_unavailable");
  }
});
