/** Actual SDK HTTP calls ask the resident connector's connection budget. */
import { Socket } from "node:net";
let channel: Socket | undefined;
let sequence = 0;
let buffer = "";
const pending = new Map<
  number,
  (reply: {
    allowed: boolean;
    retry_after?: number;
    code?: string;
    origin?: string;
  }) => void
>();
function socket() {
  const fd = process.env.PYTHIA_BUDGET_FD;
  if (!fd) return undefined; // Direct, isolated fixture/diagnostic execution.
  if (!channel) {
    channel = new Socket({ fd: Number(fd), readable: true, writable: true });
    channel.unref();
    channel.setEncoding("utf8");
    channel.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 16384) {
        channel?.destroy();
        return;
      }
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const message = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
        if (!pending.size) channel?.unref();
      }
    });
    const fail = () => {
      for (const resolve of pending.values())
        resolve({ allowed: false, retry_after: 60 });
      pending.clear();
    };
    channel.on("error", fail);
    channel.on("close", fail);
  }
  return channel;
}
export function budgetedFetch(
  input: string | URL | Request,
  init?: RequestInit,
  cost = 1,
) {
  return outbound(fetch, input, init, cost);
}
async function outbound(
  transport: typeof fetch,
  input: string | URL | Request,
  init: RequestInit | undefined,
  cost: number,
) {
  const channel = socket();
  if (!channel) return transport(input, init);
  if (channel.destroyed) throw Error("budget_unavailable");
  const id = ++sequence;
  const permit = await new Promise<{
    allowed: boolean;
    retry_after?: number;
    code?: string;
    origin?: string;
  }>((resolve) => {
    pending.set(id, resolve);
    channel.ref();
    channel.write(
      `${JSON.stringify({ type: "acquire", id, cost, request_id: process.env.PYTHIA_REQUEST_ID })}\n`,
    );
  });
  if (!permit.allowed)
    throw Object.assign(new Error(permit.code ?? "busy"), {
      code: permit.code ?? "busy",
      origin: permit.origin ?? "connector",
      retry_after_seconds: permit.retry_after ?? 1,
    });
  let response: Response | undefined;
  try {
    response = await transport(input, init);
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 8_000_000) throw Error("output_limit");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
    return new Response(
      [204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  } finally {
    const header = response?.headers.get("retry-after");
    const retry =
      header && /^\d+(\.\d+)?$/u.test(header)
        ? Number(header)
        : header
          ? Math.max(0, (Date.parse(header) - Date.now()) / 1000)
          : undefined;
    const remaining = response?.headers.get("x-ratelimit-remaining");
    channel.write(
      `${JSON.stringify({
        type: "release",
        id,
        status: response?.status,
        ...(remaining && /^\d+$/u.test(remaining)
          ? { remaining: Number(remaining) }
          : {}),
        ...(Number.isFinite(retry) ? { retry_after: retry } : {}),
      })}\n`,
    );
  }
}

/** EODHD's SDK uses global fetch; scope this wrapper to its isolated worker. */
export function installEodhdBudget(
  wrap: (error: unknown) => unknown = (error) => error,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const endpoint = url.pathname.split("/")[2];
    const cost =
      endpoint === "real-time"
        ? 1 +
          (url.searchParams.get("s")?.split(",").filter(Boolean).length ?? 0)
        : ["intraday", "technical", "news", "screener"].includes(endpoint ?? "")
          ? 5
          : endpoint === "fundamentals"
            ? 10
            : endpoint === "eod-bulk-last-day"
              ? 100 +
                (url.searchParams.get("symbols")?.split(",").filter(Boolean)
                  .length ?? 0)
              : endpoint === "user"
                ? 0
                : 1;
    // budgetedFetch must call the original transport, not this wrapper.
    return outbound(original, input, init, cost).catch((error) => {
      throw wrap(error);
    });
  };
}
