import type { WidgetDataResource } from "./binding";

export type PluginRequest = Pick<
  WidgetDataResource,
  "plugin" | "operation" | "arguments"
>;
export type DataResource = WidgetDataResource;
export type DataUpdate = {
  schema_version: 1;
  index: number;
  generation: string;
  revision: number;
  type: "snapshot" | "status" | "reset";
  state: "ready" | "stale" | "loading" | "unavailable";
  data?: unknown;
  code?: string;
  refreshAfterSeconds?: number;
};
/** Protected native exports only. Invoke belongs in an explicit user action,
 * never an automatic query; native operation permissions remain authoritative. */
export type PluginTransport = {
  read(request: PluginRequest, signal?: AbortSignal): Promise<unknown>;
  invoke(request: PluginRequest, signal?: AbortSignal): Promise<unknown>;
  updates(
    resources: DataResource[],
    signal: AbortSignal,
  ): AsyncIterable<DataUpdate>;
};
