import type { ReactNode } from "react";
import type { WidgetProps } from "./types";
import type { PluginTransport } from "./transport";
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
