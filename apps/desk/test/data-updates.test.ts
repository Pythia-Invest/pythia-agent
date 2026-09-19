import { afterEach, expect, test, vi } from "vitest";
import { type DeskApi, DeskApiError } from "../src/client/api";
import { DataUpdates } from "../src/client/data-updates";
import {
  readDataUpdates,
  type DataResource,
  type DataUpdate,
} from "../src/client/data-protocol";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const resource = (symbol: string): DataResource => ({
  plugin: "synthetic-plugin",
  operation: "synthetic",
  arguments: { symbol },
});
const snapshot = (index: number): DataUpdate => ({
  schema_version: 1,
  index,
  generation: "one",
  revision: 1,
  type: "snapshot",
  state: "ready",
  data: { price: index + 1 },
});

test("one channel groups demand, shares duplicate resources and releases only its last consumer", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  const signals: AbortSignal[] = [];
  const stream = vi.fn(async function* (
    resources: DataResource[],
    signal: AbortSignal,
  ) {
    signals.push(signal);
    for (const [index] of resources.entries()) {
      yield snapshot(index);
      yield snapshot(index);
    }
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const a: DataUpdate[] = [],
    b: DataUpdate[] = [],
    c: DataUpdate[] = [];
  const stopA = owner.watch(resource("A"), (event) => a.push(event));
  const stopB = owner.watch(resource("A"), (event) => b.push(event));
  const stopC = owner.watch(
    { ...resource("A"), plugin: "another-plugin" },
    (event) => c.push(event),
  );
  await vi.advanceTimersByTimeAsync(11);
  expect(owner.hasPublication(resource("A"))).toBe(true);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(stream.mock.calls[0]?.[0]).toHaveLength(2);
  expect(stream.mock.calls[0]?.[0].map((entry) => entry.plugin)).toEqual([
    "synthetic-plugin",
    "another-plugin",
  ]);
  expect(a).toHaveLength(1); // Duplicate delivery revisions are ignored.
  expect(b).toEqual(a);
  expect(c[0]?.data).toEqual({ price: 2 });
  stopA();
  expect(signals[0]?.aborted).toBe(false);
  const later: DataUpdate[] = [];
  const stopLater = owner.watch(resource("A"), (event) => later.push(event));
  await Promise.resolve();
  expect(later).toEqual(a);
  expect(stream).toHaveBeenCalledTimes(1);
  stopLater();
  stopB();
  stopC();
  expect(owner.hasPublication(resource("A"))).toBe(false);
  expect(signals[0]?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(50);
  expect(stream).toHaveBeenCalledTimes(1);
});

test("auth revocation clears the retained snapshot and never replays it to a new listener", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  const stream = async function* () {
    yield snapshot(0);
    throw new DeskApiError("Revoked", 403, "access_denied");
  };
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(11);
  expect(events.at(-1)).toMatchObject({ type: "reset", state: "unavailable" });
  expect(events.at(-1)).not.toHaveProperty("data");
  const replay: DataUpdate[] = [];
  const stopReplay = owner.watch(resource("A"), (event) => replay.push(event));
  await Promise.resolve();
  expect(replay).toEqual([events.at(-1)]);
  stopReplay();
  stop();
});

test("background suspension preserves data and reconnects once without reporting cancellation as failure", async () => {
  vi.useFakeTimers();
  const page = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", page);
  vi.stubGlobal("window", new EventTarget());
  const signals: AbortSignal[] = [];
  const stream = vi.fn(async function* (
    _: DataResource[],
    signal: AbortSignal,
  ) {
    signals.push(signal);
    yield snapshot(0);
    await new Promise<void>((_, reject) =>
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      ),
    );
  });
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(11);
  for (let cycle = 0; cycle < 3; cycle++) {
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(signals.at(-1)?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stream).toHaveBeenCalledTimes(cycle + 1);
    page.hidden = false;
    page.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(11);
    expect(stream).toHaveBeenCalledTimes(cycle + 2);
  }
  expect(events).toHaveLength(1);
  expect(
    events.every(
      (event) => event.type === "snapshot" && event.state === "ready",
    ),
  ).toBe(true);
  stop();
});

test("fragmented SSE frames and heartbeats preserve complete snapshots", async () => {
  const encoded = new TextEncoder().encode(
    `: heartbeat\n\ndata: ${JSON.stringify(snapshot(0))}\n\n`,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, 28));
      controller.enqueue(encoded.slice(28));
      controller.close();
    },
  });
  const events = [];
  for await (const event of readDataUpdates(new Response(body)))
    events.push(event);
  expect(events).toEqual([snapshot(0)]);
});

test("an unexpected connection failure remains visible and recovers on reconnect", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  let connections = 0;
  const stream = async function* (_: DataResource[], signal: AbortSignal) {
    yield snapshot(0);
    if (++connections === 1) throw Error("Connection lost");
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(11);
  expect(events.at(-1)).toMatchObject({
    state: "stale",
    code: "connection_lost",
    data: { price: 1 },
  });
  await vi.advanceTimersByTimeAsync(1500);
  expect(events.at(-1)).toMatchObject({ type: "snapshot", state: "ready" });
  stop();
});

test("unsupported update intent is visible and waits for explicit retry", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  // biome-ignore lint/correctness/useYield: A rejected subscription fails before emitting its first frame.
  const stream = vi.fn(async function* () {
    throw new DeskApiError("Not declared", 400, "unsupported_operation");
  });
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(events).toEqual([
    expect.objectContaining({
      type: "reset",
      state: "unavailable",
      code: "unsupported_operation",
    }),
  ]);
  owner.refresh();
  await vi.advanceTimersByTimeAsync(11);
  expect(stream).toHaveBeenCalledTimes(2);
  stop();
});

test("equivalent nested argument objects share demand regardless of insertion order", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  const stream = vi.fn(async function* (
    resources: DataResource[],
    signal: AbortSignal,
  ) {
    for (const [index] of resources.entries()) yield snapshot(index);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  });
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const first = {
    ...resource("A"),
    arguments: { a: 1, nested: { b: 2, c: [3, 4] } },
  };
  const second = {
    ...resource("A"),
    arguments: { nested: { c: [3, 4], b: 2 }, a: 1 },
  };
  const stopA = owner.watch(first, () => {});
  const received: DataUpdate[] = [];
  const stopB = owner.watch(second, (event) => received.push(event));
  await vi.advanceTimersByTimeAsync(11);
  expect(stream.mock.calls[0]?.[0]).toHaveLength(1);
  expect(received).toEqual([snapshot(0)]);
  stopA();
  stopB();
});

test("explicit reads publish to peers and native replay cursors survive channel rebuilds", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  let event = snapshot(0);
  const stream = async function* (_: DataResource[], signal: AbortSignal) {
    yield event;
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const observed: { value: DataUpdate; origin: string }[] = [];
  const stop = owner.watch(resource("A"), (value, origin) =>
    observed.push({ value, origin }),
  );
  await vi.advanceTimersByTimeAsync(11);
  owner.publishRead(resource("A"), { price: 456 });
  expect(observed.at(-1)).toMatchObject({
    origin: "read",
    value: { data: { price: 456 } },
  });
  const peer: DataUpdate[] = [];
  const stopPeer = owner.watch(resource("A"), (value) => peer.push(value));
  await Promise.resolve();
  expect(peer.at(-1)?.data).toEqual({ price: 456 });
  owner.refresh();
  await vi.advanceTimersByTimeAsync(11);
  expect(peer.at(-1)?.data).toEqual({ price: 456 });
  // The native endpoint may revalidate a retained snapshot into a reset without
  // changing its resource revision. Such denial must never be deduplicated.
  event = {
    ...snapshot(0),
    type: "reset",
    state: "unavailable",
    data: undefined,
    code: "access_denied",
  };
  owner.refresh();
  await vi.advanceTimersByTimeAsync(11);
  expect(peer.at(-1)).toMatchObject({ type: "reset", state: "unavailable" });
  expect(peer.at(-1)?.data).toBeUndefined();
  stopPeer();
  stop();
});

test("failed explicit reads retain only transient qualified data and clear native denial for peers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  const stream = async function* (_: DataResource[], signal: AbortSignal) {
    yield snapshot(0);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(11);
  owner.failRead(resource("A"), new DeskApiError("Busy", 503));
  expect(events.at(-1)).toMatchObject({ state: "stale", data: { price: 1 } });
  owner.failRead(resource("A"), new DeskApiError("Denied", 403));
  expect(events.at(-1)).toMatchObject({ type: "reset", state: "unavailable" });
  expect(events.at(-1)?.data).toBeUndefined();
  const later: DataUpdate[] = [];
  const stopLater = owner.watch(resource("A"), (event) => later.push(event));
  await Promise.resolve();
  expect(later.at(-1)?.data).toBeUndefined();
  stopLater();
  stop();
});

test("reconnection removes only transport failure, preserving a provider stale qualifier", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { hidden: false }),
  );
  vi.stubGlobal("window", new EventTarget());
  let connected = false;
  const stream = async function* (_: DataResource[], signal: AbortSignal) {
    yield {
      ...snapshot(0),
      type: "status" as const,
      state: "stale" as const,
      code: "provider_unavailable",
    };
    if (!connected) {
      connected = true;
      throw Error("Disconnected");
    }
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const owner = new DataUpdates({ dataUpdates: stream } as unknown as DeskApi);
  const events: DataUpdate[] = [];
  const stop = owner.watch(resource("A"), (event) => events.push(event));
  await vi.advanceTimersByTimeAsync(11);
  expect(events.at(-1)?.code).toBe("connection_lost");
  await vi.advanceTimersByTimeAsync(1500);
  expect(events.at(-1)).toMatchObject({
    state: "stale",
    code: "provider_unavailable",
    data: { price: 1 },
  });
  stop();
});

test.each(["resource", "channel", "manual"] as const)(
  "%s withdrawal accepts a subsequently authorized snapshot at the same native revision",
  async (kind) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "document",
      Object.assign(new EventTarget(), { hidden: false }),
    );
    vi.stubGlobal("window", new EventTarget());
    let denied = false;
    const stream = async function* (_: DataResource[], signal: AbortSignal) {
      if (denied && kind === "channel") throw new DeskApiError("Denied", 403);
      yield denied
        ? {
            ...snapshot(0),
            type: "reset" as const,
            state: "unavailable" as const,
            data: undefined,
            code: "access_denied",
          }
        : snapshot(0);
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    };
    const owner = new DataUpdates({
      dataUpdates: stream,
    } as unknown as DeskApi);
    const events: DataUpdate[] = [];
    const stop = owner.watch(resource("A"), (event) => events.push(event));
    await vi.advanceTimersByTimeAsync(11);
    expect(events.at(-1)?.data).toEqual({ price: 1 });
    if (kind === "manual")
      owner.failRead(resource("A"), new DeskApiError("Denied", 403));
    else {
      denied = true;
      owner.refresh();
      await vi.advanceTimersByTimeAsync(11);
    }
    expect(events.at(-1)).toMatchObject({
      type: "reset",
      state: "unavailable",
    });
    expect(events.at(-1)?.data).toBeUndefined();
    denied = false;
    owner.refresh();
    await vi.advanceTimersByTimeAsync(11);
    expect(events.at(-1)).toEqual(snapshot(0));
    stop();
  },
);
