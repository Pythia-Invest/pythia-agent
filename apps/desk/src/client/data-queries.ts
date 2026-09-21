"use client";
import { useEffect, useRef } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useDeskApi } from "./providers";
import { dataUpdates } from "./data-updates";
import { DeskApiError } from "./api";
import type { DataResource } from "./data-protocol";
import { dataResourceKey } from "./data-resource";

export type DataQuery<T> = {
  key: readonly unknown[];
  resource: DataResource;
  enabled: boolean;
  decode: (value: unknown) => T;
  reconcile?: (previous: T | undefined, next: T) => T;
  /** Raw native response; decode and publication use the same path as updates. */
  read?: (signal: AbortSignal) => Promise<unknown>;
};

/** TanStack owns browser state; the shared channel owns refresh demand. */
export function useDataQueries<T>(specifications: DataQuery<T>[]) {
  const client = useQueryClient();
  const updates = dataUpdates(useDeskApi());
  const latest = useRef(specifications);
  latest.current = specifications;
  const signature = JSON.stringify(
    specifications.map(({ key, resource, enabled }) => ({
      key,
      resource: dataResourceKey(resource),
      enabled,
    })),
  );
  const queries = useQueries({
    queries: specifications.map((spec) => ({
      queryKey: spec.key,
      enabled: false,
      staleTime: Infinity,
      gcTime: 600_000,
      retry: false,
      queryFn: async ({ signal }) => {
        // Explicit retry uses the existing protected read path. Reconnecting
        // SSE alone can replay its retained failed snapshot before it is due.
        if (spec.read) {
          try {
            const raw = await spec.read(signal);
            signal.throwIfAborted();
            let next: T;
            try {
              next = spec.decode(raw);
            } catch {
              throw new DeskApiError(
                "The data response could not be read.",
                502,
                "invalid_response",
              );
            }
            const value =
              spec.reconcile?.(client.getQueryData<T>(spec.key), next) ?? next;
            updates.publishRead(spec.resource, raw);
            return value;
          } catch (error) {
            if (!signal.aborted) updates.failRead(spec.resource, error);
            throw error;
          }
        }
        updates.refresh();
        return await new Promise<T>((resolve, reject) => {
          const aborted = () => {
            clearTimeout(timer);
            stop();
            reject(new DOMException("Data read cancelled.", "AbortError"));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", aborted);
            stop();
            reject(Error("Data refresh timed out."));
          }, 35_000);
          const stop = updates.watch(spec.resource, (event) => {
            if (event.type === "snapshot") {
              clearTimeout(timer);
              signal.removeEventListener("abort", aborted);
              stop();
              try {
                const next = spec.decode(event.data);
                resolve(
                  spec.reconcile?.(client.getQueryData<T>(spec.key), next) ??
                    next,
                );
              } catch (error) {
                reject(error);
              }
            } else if (event.state === "unavailable") {
              clearTimeout(timer);
              signal.removeEventListener("abort", aborted);
              stop();
              reject(Error("Data is unavailable."));
            }
          });
          signal.addEventListener("abort", aborted, { once: true });
          if (signal.aborted) aborted();
        });
      },
    })),
  });
  useEffect(() => {
    for (const spec of latest.current) {
      if (spec.enabled && !updates.hasPublication(spec.resource)) {
        client
          .getQueryCache()
          .find({ queryKey: spec.key, exact: true })
          ?.setState({
            data: undefined,
            error: null,
            status: "pending",
          });
      }
    }
    const stops = latest.current.map((spec) =>
      !spec.enabled
        ? () => undefined
        : updates.watch(spec.resource, (event, origin) => {
            const query = client
              .getQueryCache()
              .find({ queryKey: spec.key, exact: true });
            if (!query) return;
            // Cancel the actual TanStack retryer, regardless of presentation
            // state. A status/mask must never hide an in-flight read from reset.
            // A new denial cancels peers too; successful manual publication
            // and replay of an old reset cannot cancel a current validation.
            if (
              (event.type === "reset" && origin !== "replay") ||
              (event.type === "snapshot" && origin === "native")
            )
              void client.cancelQueries(
                { queryKey: spec.key, exact: true },
                { silent: true },
              );
            if (event.type === "reset") {
              query.setState({
                data: undefined,
                status: event.state === "loading" ? "pending" : "error",
                error:
                  event.state === "loading"
                    ? null
                    : new DeskApiError(
                        event.code === "unsupported_operation"
                          ? "Requested plugin updates are unavailable. Check the operation declaration."
                          : event.code === "invalid_subscription"
                            ? "The update subscription was rejected. Check its configuration."
                            : "Data access changed. Check the connection in Settings.",
                        403,
                        event.code,
                      ),
              });
              return;
            }
            try {
              if (event.data !== undefined) {
                const next = spec.decode(event.data);
                client.setQueryData<T>(
                  spec.key,
                  (old) => spec.reconcile?.(old, next) ?? next,
                );
              }
              if (event.state === "stale")
                query.setState({
                  error: new DeskApiError(
                    query.state.data === undefined
                      ? "Data could not be loaded. Retrying shortly."
                      : "Updates are temporarily unavailable. Showing the last received value.",
                    503,
                    event.code,
                  ),
                  status: query.state.data === undefined ? "error" : "success",
                });
            } catch {
              query.setState({
                data: undefined,
                status: "error",
                error: new DeskApiError(
                  "The data response could not be read.",
                  502,
                  "invalid_response",
                ),
              });
            }
          }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [signature, client, updates]);
  return queries.map((query, index) => {
    const spec = specifications[index];
    if (!spec?.enabled || !updates.hasPublication(spec.resource)) {
      return {
        ...query,
        data: undefined,
        error: null,
        isPending: true,
        isError: false,
        isSuccess: false,
        status: "pending" as const,
      };
    }
    return query;
  });
}
