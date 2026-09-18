/** Optional demand-owned, serial RPC host. SDKs can queue native HTTP internally.
 * The parent owns its lifetime, pending bound, output limit and actual permits. */
import { createInterface } from "node:readline";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
const context = new AsyncLocalStorage<AbortSignal>();
export const workerSignal = () => context.getStore();
export async function serveWorker(
  execute: (request: unknown) => Promise<unknown>,
) {
  const pending = new Map<string, AbortController>();
  let chain = Promise.resolve();
  for await (const line of createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  })) {
    if (line.length > 65536) throw Error("input_limit");
    const message = JSON.parse(line);
    if (message.type === "init") continue;
    if (typeof message.id !== "string" || !/^[a-f0-9]{16}$/u.test(message.id))
      throw Error("invalid_request");
    if (message.type === "cancel") {
      pending.get(message.id)?.abort();
      continue;
    }
    if (
      message.type !== "request" ||
      pending.size >= 32 ||
      pending.has(message.id)
    )
      throw Error("invalid_request");
    const controller = new AbortController();
    pending.set(message.id, controller);
    chain = chain.then(async () => {
      try {
        if (controller.signal.aborted) return;
        process.env.PYTHIA_REQUEST_ID = message.id;
        const result = await context.run(controller.signal, () =>
          execute(message.request),
        );
        if (controller.signal.aborted) return;
        const output = JSON.stringify({
          type: "result",
          id: message.id,
          result,
        });
        if (output.length > 1_900_000) throw Error("output_limit");
        if (!process.stdout.write(`${output}\n`))
          await once(process.stdout, "drain");
      } finally {
        pending.delete(message.id);
      }
    });
    // Fail the owned worker instead of leaving a poisoned queue alive.
    void chain.catch(() => {
      process.exitCode = 1;
      process.stdin.destroy();
    });
  }
  for (const controller of pending.values()) controller.abort();
  await chain;
}
