import type { ReadInput } from "@pythia/market-data";
import {
  financialRequestSchema,
  readResultSchema,
  type FinancialRead,
} from "@pythia/market-data/widgets/contract";
import {
  createPluginTransport,
  type PluginTransport,
} from "./plugin-transport";

type Entry = {
  value: FinancialRead;
  scope: string;
  expires: number;
  bytes: number;
};
type Pending = {
  input: ReadInput;
  consumers: Set<Consumer>;
  cancel?: () => void;
};
type Consumer = {
  resolve: (value: FinancialRead) => void;
  reject: (reason: unknown) => void;
  cleanup: () => void;
};
/** HTTP aggregation only: canonical selection and normalization stay in the
 * native feature. Cache hits revalidate that feature's access/identity/settings
 * scope. Keys are individual financial requests, never widget IDs or lists. */
export function createFinancialDataService(
  environment = process.env,
  command: PluginTransport = createPluginTransport(environment),
  now = Date.now,
) {
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Pending>();
  const pending = new Map<string, Pending>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bytes = 0;
  const args = (request: unknown) => ({
    plugin: "pythia-market-data",
    operation: "query",
    arguments: request,
    readOnly: true,
  });
  function evict(key: string) {
    bytes -= cache.get(key)?.bytes ?? 0;
    cache.delete(key);
  }
  function settle(
    key: string,
    item: Pending,
    value?: FinancialRead,
    error?: unknown,
  ) {
    for (const consumer of item.consumers) {
      consumer.cleanup();
      if (value) consumer.resolve(structuredClone(value));
      else consumer.reject(error);
    }
    item.consumers.clear();
    if (inflight.get(key) === item) inflight.delete(key);
  }
  async function execute(entries: [string, Pending][], reuse?: string) {
    entries = entries.filter(([, item]) => item.consumers.size > 0);
    if (!entries.length) return;
    const reads = entries.map(([, item]) => item.input);
    const flags = args({ action: "read_many", reads });
    const controller = new AbortController();
    const cancel = () => {
      if (entries.every(([, item]) => item.consumers.size === 0))
        controller.abort();
    };
    for (const [, item] of entries) item.cancel = cancel;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30_000),
    ]);
    const value = JSON.parse(
      await command(reuse ? { ...flags, reuseScope: reuse } : flags, signal),
    );
    if (value.reuse) {
      if (value.reuse !== reuse) throw Error("invalid_reuse");
      for (const [key, item] of entries) {
        const cached = cache.get(key);
        if (!cached || cached.scope !== reuse || cached.expires <= now()) {
          // A local cache expiring during native scope validation needs a read.
          await execute([[key, item]]);
        } else settle(key, item, cached.value);
      }
      return;
    }
    if (
      value.schema_version !== 1 ||
      value.outcome !== "ok" ||
      !Array.isArray(value.data) ||
      value.data.length !== reads.length
    )
      throw Error("financial_read_unavailable");
    const parsed = value.data.map((row: unknown, index: number) => {
      const result = readResultSchema.parse(row);
      if (
        JSON.stringify(result.request) !== JSON.stringify(reads[index]?.request)
      )
        throw Error("read_intent_mismatch");
      const reported = value.delivery?.max_age_seconds?.[index];
      const age =
        Number.isInteger(reported) && reported >= 0 && reported <= 86400
          ? (reported as number)
          : 0;
      const retry = Math.max(
        0,
        ...result.issues.map((issue) => issue.retry_after_seconds ?? 0),
      );
      return {
        value: { result, refreshAfterSeconds: Math.max(age, retry, 15) },
        age,
      };
    });
    for (const [index, [key, item]] of entries.entries()) {
      if (!item.consumers.size) continue;
      const row = parsed[index];
      if (!row) throw Error("financial_read_unavailable");
      evict(key);
      const scope = value.delivery?.reuse_scope;
      const expires =
        Date.parse(row.value.result.retrieved_at) + row.age * 1000;
      if (
        row.value.result.outcome !== "error" &&
        row.age > 0 &&
        expires > now() &&
        Date.parse(row.value.result.retrieved_at) <= now() &&
        typeof scope === "string" &&
        /^[a-f0-9]{64}$/u.test(scope)
      ) {
        const size = JSON.stringify(row.value).length * 2;
        if (size <= 2_000_000) {
          while (cache.size >= 128 || bytes + size > 8_000_000) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            evict(oldest);
          }
          cache.set(key, {
            value: structuredClone(row.value),
            scope,
            expires,
            bytes: size,
          });
          bytes += size;
        }
      }
      settle(key, item, row.value);
    }
  }
  async function flush() {
    timer = undefined;
    const entries = [...pending.entries()];
    pending.clear();
    // Revalidate cached subsets together. Cold/expired requests form their own
    // native batch, so an overlapping widget does not refetch the warm subset.
    const groups = new Map<string, [string, Pending][]>();
    for (const entry of entries) {
      const cached = cache.get(entry[0]);
      const scope = cached && cached.expires > now() ? cached.scope : "";
      if (!scope) evict(entry[0]);
      const group = groups.get(scope) ?? [];
      group.push(entry);
      groups.set(scope, group);
    }
    for (const [scope, group] of groups) {
      // History rows are much larger than quote rows. Bound each HTTP response
      // by requested observations as well as read count; keep quote batching.
      for (let offset = 0; offset < group.length; ) {
        const batch: typeof group = [];
        let observations = 0;
        while (offset < group.length && batch.length < 32) {
          const entry = group[offset];
          if (!entry) break;
          const count = entry[1].input.request.limit;
          if (batch.length && observations + count > 16_000) break;
          batch.push(entry);
          observations += count;
          offset += 1;
        }
        try {
          await execute(batch, scope || undefined);
        } catch (error) {
          for (const [key, item] of batch) {
            evict(key);
            settle(key, item, undefined, error);
          }
        } finally {
          for (const [key, item] of batch)
            if (inflight.get(key) === item) inflight.delete(key);
        }
      }
    }
  }
  return {
    async read(input: unknown, callerSignal: AbortSignal) {
      const { reads } = financialRequestSchema.parse(input);
      const controller = new AbortController();
      const signal = AbortSignal.any([callerSignal, controller.signal]);
      signal.throwIfAborted();
      try {
        const results = await Promise.all(
          reads.map(async (read) => {
            const key = JSON.stringify(read);
            let item = inflight.get(key);
            if (!item) {
              if (inflight.size >= 128) throw Error("financial_read_limit");
              item = { input: read, consumers: new Set() };
              pending.set(key, item);
              inflight.set(key, item);
            }
            const entry = item;
            const promise = new Promise<FinancialRead>((resolve, reject) => {
              const abort = () => {
                entry.consumers.delete(consumer);
                consumer.cleanup();
                reject(signal.reason);
                if (!entry.consumers.size) {
                  if (inflight.get(key) === entry) inflight.delete(key);
                  if (pending.get(key) === entry) pending.delete(key);
                  entry.cancel?.();
                }
              };
              const consumer = {
                resolve,
                reject,
                cleanup: () => signal.removeEventListener("abort", abort),
              };
              entry.consumers.add(consumer);
              signal.addEventListener("abort", abort, { once: true });
              if (signal.aborted) abort();
            });
            if (timer === undefined)
              timer = setTimeout(() => {
                void flush();
              }, 5);
            return promise;
          }),
        );
        signal.throwIfAborted();
        return results;
      } finally {
        // A failed read releases this caller's other pending reads as well.
        controller.abort();
      }
    },
    async preferences(signal: AbortSignal): Promise<{ revision: number }> {
      const value = JSON.parse(
        await command(args({ action: "get_preferences" }), signal),
      );
      if (
        value.schema_version !== 1 ||
        value.outcome !== "ok" ||
        !Number.isSafeInteger(value.data?.revision) ||
        value.data.revision < 0
      )
        throw Error("preferences_unavailable");
      return { revision: value.data.revision };
    },
  };
}
const key = Symbol.for("pythia.desk.financial-data");
const owner = globalThis as typeof globalThis & {
  [key]?: ReturnType<typeof createFinancialDataService>;
};
owner[key] ??= createFinancialDataService();
export const financialDataService = owner[key];
