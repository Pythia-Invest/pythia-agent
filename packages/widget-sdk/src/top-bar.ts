import type { ReactNode } from "react";
import type { WidgetProps } from "./types";
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
export type TopBarContext = {
  title: string;
  query: string;
  onQueryChange(query: string): void;
  actions?: ReactNode;
  /** Currently available native summaries, not an exhaustive history index. */
  chats: readonly { id: string; title: string }[];
  openChat(id: string): void;
  /** Stages an unsent prompt while preserving any existing draft. */
  prepareChat(text: string): void;
  transport: PluginTransport;
};
/** Native presentation input_contract: pythia.desk-topbar.v1. */
export type TopBarProps = WidgetProps<TopBarContext>;
