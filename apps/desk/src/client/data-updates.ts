import { type DeskApi, DeskApiError } from "./api";
import type { DataResource, DataUpdate } from "./data-protocol";

import { dataResourceKey } from "./data-resource";

// Read and replay deliveries must not cancel the query performing that read.
type Origin = "native" | "read" | "replay";
type Listener = (update: DataUpdate, origin: Origin) => void;
type Entry = {
  resource: DataResource;
  listeners: Set<Listener>;
  latest?: DataUpdate;
  native?: { generation: string; revision: number };
  interrupted?: { previous: DataUpdate | undefined };
};
const owners = new WeakMap<DeskApi, DataUpdates>();

/** One channel per browser client. Resources are reference-counted; mounting a
 * second card is another consumer, not another network connection or timer. */
export class DataUpdates {
  private entries = new Map<string, Entry>();
  private controller: AbortController | undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private version = 0;
  private attempt = 0;
  private readRevision = 0;
  constructor(private api: DeskApi) {}
  /** Only active demand retains a native publication; TanStack cache alone is not a grant. */
  hasPublication(resource: DataResource) {
    return this.entries.get(dataResourceKey(resource))?.latest !== undefined;
  }

  private pageHide = () => this.stop();
  private pageShow = () => this.schedule();

  private visibility = () => {
    if (document.hidden) {
      // Suspending demand is not a failed read. Preserve the last result;
      // resume rechecks access and receives the server's qualified snapshot.
      this.stop();
    } else this.schedule();
  };

  watch(resource: DataResource, listener: Listener) {
    const key = dataResourceKey(resource);
    const existing = this.entries.get(key);
    if (!this.entries.size) {
      document.addEventListener("visibilitychange", this.visibility);
      window.addEventListener("pagehide", this.pageHide);
      window.addEventListener("pageshow", this.pageShow);
    }
    const entry: Entry = existing ?? {
      resource,
      listeners: new Set<Listener>(),
    };
    entry.listeners.add(listener);
    this.entries.set(key, entry);
    if (!existing) this.schedule();
    else if (entry.latest)
      queueMicrotask(() => {
        if (entry.listeners.has(listener) && entry.latest)
          listener(entry.latest, "replay");
      });
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        this.entries.delete(key);
        this.schedule();
      }
      if (!this.entries.size) {
        this.stop();
        document.removeEventListener("visibilitychange", this.visibility);
        window.removeEventListener("pagehide", this.pageHide);
        window.removeEventListener("pageshow", this.pageShow);
      }
    };
  }

  private stop() {
    this.version += 1;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = undefined;
  }

  private status(state: "stale" | "unavailable", code: string) {
    for (const entry of this.entries.values()) {
      if (state === "stale") entry.interrupted ??= { previous: entry.latest };
      else {
        delete entry.interrupted;
        delete entry.native;
      }
      entry.latest = {
        schema_version: 1,
        index: 0,
        generation: "transport",
        revision: 1,
        type: state === "stale" ? "status" : "reset",
        state,
        code,
        ...(state === "stale" && entry.latest?.data !== undefined
          ? { data: entry.latest.data }
          : {}),
      };
      for (const listener of entry.listeners) listener(entry.latest, "native");
    }
  }

  /** A protected explicit read replaces the retained publication for all peers. */
  publishRead(resource: DataResource, data: unknown) {
    const entry = this.entries.get(dataResourceKey(resource));
    if (!entry) return;
    delete entry.interrupted;
    entry.latest = {
      schema_version: 1,
      index: 0,
      generation: "read",
      revision: ++this.readRevision,
      type: "snapshot",
      state: "ready",
      data,
    };
    for (const listener of entry.listeners) listener(entry.latest, "read");
  }

  failRead(resource: DataResource, error: unknown) {
    const entry = this.entries.get(dataResourceKey(resource));
    if (!entry) return;
    delete entry.interrupted;
    const rejected =
      error instanceof DeskApiError &&
      ([400, 401, 403, 404, 405, 409, 413, 415, 422].includes(error.status) ||
        error.code === "invalid_response");
    if (rejected) delete entry.native;
    entry.latest = {
      schema_version: 1,
      index: 0,
      generation: "read",
      revision: ++this.readRevision,
      type: rejected ? "reset" : "status",
      state: rejected ? "unavailable" : "stale",
      code:
        error instanceof DeskApiError
          ? (error.code ?? "read_failed")
          : "read_failed",
      ...(!rejected && entry.latest?.data !== undefined
        ? { data: entry.latest.data }
        : {}),
    };
    for (const listener of entry.listeners) listener(entry.latest, "read");
  }

  refresh() {
    this.attempt = 0;
    this.schedule();
  }

  private schedule(delay = 10) {
    this.stop();
    if (!this.entries.size || document.hidden) return;
    this.timer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private async connect() {
    const version = this.version;
    const entries = [...this.entries.values()];
    const controller = new AbortController();
    this.controller = controller;
    try {
      for await (const update of this.api.dataUpdates(
        entries.map((entry) => entry.resource),
        controller.signal,
      )) {
        if (version !== this.version) return;
        const entry = entries[update.index];
        if (!entry) throw Error("Unknown update resource.");
        const last = entry.native;
        if (
          update.type !== "reset" &&
          last?.generation === update.generation &&
          last.revision >= update.revision
        ) {
          // Revalidation confirms transport is back, not that an observation is
          // newer. Restore only the pre-disconnect qualification, which may
          // itself be stale or a newer protected manual read.
          const restored = entry.interrupted?.previous;
          delete entry.interrupted;
          if (restored) {
            entry.latest = restored;
            for (const listener of entry.listeners)
              listener(restored, "replay");
          }
          continue;
        }
        delete entry.interrupted;
        // Cursors survive channel rebuilds while demand is active. A retained
        // native replay cannot replace a newer explicit read. Resets always
        // apply: native admission can turn a queued snapshot into a denial.
        if (update.type === "reset") delete entry.native;
        else if (
          last?.generation !== update.generation ||
          last.revision < update.revision
        )
          entry.native = {
            generation: update.generation,
            revision: update.revision,
          };
        entry.latest = update;
        this.attempt = 0;
        for (const listener of entry.listeners) listener(update, "native");
      }
      if (!controller.signal.aborted) throw Error("Update connection closed.");
    } catch (error) {
      if (version !== this.version || controller.signal.aborted) return;
      const revoked =
        error instanceof DeskApiError && [401, 403].includes(error.status);
      const rejected =
        error instanceof DeskApiError &&
        [400, 404, 405, 413, 415, 422].includes(error.status);
      this.status(
        revoked || rejected ? "unavailable" : "stale",
        revoked
          ? "access_denied"
          : rejected
            ? (error.code ?? "invalid_subscription")
            : "connection_lost",
      );
      // Invalid intent or an absent update declaration needs an explicit retry
      // or a configuration change, not another automatic polling cadence.
      if (rejected) return;
      this.attempt += 1;
      this.schedule(
        Math.min(30_000, 1000 * 2 ** Math.min(5, this.attempt - 1)) *
          (0.8 + Math.random() * 0.4),
      );
    }
  }
}

export function dataUpdates(api: DeskApi) {
  let owner = owners.get(api);
  if (!owner) {
    owner = new DataUpdates(api);
    owners.set(api, owner);
  }
  return owner;
}
