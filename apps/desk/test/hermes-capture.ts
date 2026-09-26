import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHermesClient } from "@/server/hermes";

/**
 * Goldens captured from the pinned Hermes by
 * `tooling/qualification/hermes-wire-capture.py` (ADR 0020). They are Hermes's
 * own output, so tests that read them are not their own oracle; regenerate
 * with `just capture-hermes` after a Hermes bump and review the diff.
 */
const DIRECTORY = join(import.meta.dirname, "fixtures", "hermes");

export type CapturedExchange = {
  request: { method: string; path: string; json?: unknown };
  status: number;
  body?: unknown;
  sse?: string[];
};

export function captured<T = { exchanges: CapturedExchange[] }>(
  name: string,
): T {
  return JSON.parse(readFileSync(join(DIRECTORY, name), "utf8")) as T;
}

type CliOutput = {
  args: string[];
  exit_code: number;
  stdout: string;
  stderr: string;
};

/** Native `hermes` CLI output Desk and the lifecycle scripts parse. */
export function capturedCli() {
  return captured<
    Record<"auth_status_logged_out" | "config_get_missing", CliOutput>
  >("cli.json");
}

/** The SSE body exactly as Hermes wrote it: one blank line ends each frame. */
export function sseText(frames: readonly string[]) {
  return frames.map((frame) => `${frame}\n\n`).join("");
}

/** Every captured `data:` frame, parsed. */
export function sseEvents(exchanges: readonly CapturedExchange[]) {
  return exchanges.flatMap((exchange) =>
    (exchange.sse ?? []).flatMap((frame) =>
      frame.startsWith("data: ")
        ? [JSON.parse(frame.slice(6)) as Record<string, unknown>]
        : [],
    ),
  );
}

/**
 * Desk's real Hermes client, served the captured exchanges in order. A
 * request Hermes was never asked in the capture fails the test.
 */
export function capturedClient(exchanges: readonly CapturedExchange[]) {
  const pending = [...exchanges];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const index = pending.findIndex(
      (exchange) =>
        exchange.request.method === method &&
        new URL(exchange.request.path, url).pathname === url.pathname,
    );
    const [exchange] = index < 0 ? [] : pending.splice(index, 1);
    if (!exchange) throw new Error(`No captured ${method} ${url.pathname}`);
    if (exchange.sse)
      return new Response(sseText(exchange.sse), {
        status: exchange.status,
        headers: { "content-type": "text/event-stream" },
      });
    return Response.json(exchange.body, { status: exchange.status });
  };
  return createHermesClient({
    apiKey: "capture-bearer-0123456789",
    baseUrl: "http://127.0.0.1:8642",
    fetch: fetcher as typeof fetch,
  });
}
