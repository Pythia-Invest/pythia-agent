"use client";

import { Alert, Badge, Button, Switch } from "@pythia/ui";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import {
  useAgentPlugins,
  useMcpServers,
  useSetAgentPlugin,
  useSetMcpServer,
} from "@/client/hermes-settings-queries";
import {
  useChangeDeviceSetting,
  useDeviceSettings,
} from "@/client/settings-queries";
import { Command } from "@/components/settings/command";
import { ListRow, RowsSkeleton } from "@/components/settings/primitives";

export type Filter = "all" | "on" | "off";

/** One capability, whichever list it comes from. */
export type Item = {
  id: string;
  title: string;
  description?: string | undefined;
  meta?: string | undefined;
  on: boolean;
  locked?: string | undefined;
  below?: ReactNode;
  toggle: (on: boolean) => void;
  pending: boolean;
  error?: Error | null | undefined;
};

type Loaded = {
  items: Item[];
  pending: boolean;
  error: Error | null;
  retry: () => void;
  empty: ReactNode;
};

const plain = (value: string) =>
  value.replace(/^[\p{Emoji}\p{Extended_Pictographic}\s]+/u, "").trim() ||
  value;

export function useSkills(): Loaded {
  const settings = useDeviceSettings();
  const change = useChangeDeviceSetting();
  const failed = (name: string) =>
    change.variables?.kind === "skill" &&
    "name" in change.variables &&
    change.variables.name === name
      ? change.error
      : null;
  return {
    items:
      settings.data?.skills_status === "ready"
        ? settings.data.skills.map((skill) => ({
            id: skill.name,
            title: skill.name,
            description: skill.description,
            on: skill.enabled,
            locked: skill.mutable
              ? undefined
              : "Hermes needs this skill, so it stays on.",
            pending: change.isPending,
            error: failed(skill.name),
            toggle: (enabled) =>
              change.mutate({ kind: "skill", name: skill.name, enabled }),
          }))
        : [],
    pending: settings.isPending,
    error:
      settings.error ??
      (settings.data && settings.data.skills_status !== "ready"
        ? new Error("Hermes couldn't list its skills right now.")
        : null),
    retry: () => void settings.refetch(),
    empty: "No skills installed.",
  };
}

export function useTools(): Loaded {
  const settings = useDeviceSettings();
  const change = useChangeDeviceSetting();
  const failed = (name: string) =>
    change.variables?.kind === "toolset" &&
    "name" in change.variables &&
    change.variables.name === name
      ? change.error
      : null;
  return {
    items:
      settings.data?.toolsets_status === "ready"
        ? settings.data.toolsets.map((tool) => {
            const title = plain(tool.label || "") || tool.name;
            return {
              id: tool.name,
              title,
              description: tool.description,
              meta: tool.name === title ? undefined : tool.name,
              on: tool.enabled,
              pending: change.isPending,
              error: failed(tool.name),
              below: tool.configured ? null : (
                <p className="m-0 mt-1 text-foreground-secondary text-xs">
                  It may need more setup on the device before it works.
                </p>
              ),
              toggle: (enabled) =>
                change.mutate({ kind: "toolset", name: tool.name, enabled }),
            };
          })
        : [],
    pending: settings.isPending,
    error:
      settings.error ??
      (settings.data && settings.data.toolsets_status !== "ready"
        ? new Error("Hermes couldn't list its tools right now.")
        : null),
    retry: () => void settings.refetch(),
    empty: "No tools available.",
  };
}

export function useConnectors(): Loaded {
  const servers = useMcpServers();
  const set = useSetMcpServer();
  return {
    items: (servers.data ?? []).map((server) => ({
      id: server.name,
      title: server.name,
      meta: server.transport,
      description: server.tools
        ? `${server.tools.length} selected tools`
        : "All of its tools",
      on: server.enabled,
      pending: set.isPending,
      error: set.variables?.name === server.name ? set.error : null,
      toggle: (enabled) => set.mutate({ name: server.name, enabled }),
    })),
    pending: servers.isPending,
    error: servers.error,
    retry: () => void servers.refetch(),
    empty: (
      <>
        No connectors yet. Add an MCP server on the device with{" "}
        <code>hermes mcp add</code>; it appears here to switch on and off.
      </>
    ),
  };
}

export function usePlugins(): Loaded {
  const plugins = useAgentPlugins();
  const set = useSetAgentPlugin();
  return {
    // Plugin names repeat across kinds (an image and a speech "deepinfra").
    items: (plugins.data ?? []).map((plugin, index) => ({
      id: `${plugin.name}:${index}`,
      title: plugin.name,
      description: plugin.description,
      meta: [plugin.version && `v${plugin.version}`, plugin.source]
        .filter(Boolean)
        .join(" · "),
      on: plugin.active,
      locked: plugin.locked,
      pending: set.isPending,
      error: set.variables?.name === plugin.name ? set.error : null,
      below: plugin.authCommand ? (
        <div className="mt-2">
          <Command value={plugin.authCommand} />
        </div>
      ) : null,
      toggle: (enabled) => set.mutate({ name: plugin.name, enabled }),
    })),
    pending: plugins.isPending,
    error: plugins.error,
    retry: () => void plugins.refetch(),
    empty: "No plugins installed.",
  };
}

export function matchesFilter(item: Item, filter: Filter, query: string) {
  if (filter === "on" && !item.on) return false;
  if (filter === "off" && item.on) return false;
  const text = `${item.title} ${item.meta ?? ""} ${item.description ?? ""}`;
  return query
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every((term) => text.toLowerCase().includes(term));
}

/** A list of capabilities as rows, each with its switch. */
export function CapabilityList({
  loaded,
  filter,
  query,
  label,
}: {
  loaded: Loaded;
  filter: Filter;
  query: string;
  label: string;
}) {
  if (loaded.pending) return <RowsSkeleton rows={6} />;
  if (loaded.error)
    return (
      <Alert
        tone="error"
        title={`${label} didn't load`}
        action={
          <Button size="sm" variant="secondary" onClick={loaded.retry}>
            Try again
          </Button>
        }
      >
        {loaded.error.message}
      </Alert>
    );
  if (!loaded.items.length)
    return (
      <p className="m-0 rounded-control border border-border border-dashed px-4 py-8 text-center text-body text-foreground-secondary">
        {loaded.empty}
      </p>
    );
  const shown = loaded.items.filter((item) =>
    matchesFilter(item, filter, query),
  );
  if (!shown.length)
    return (
      <p className="m-0 py-8 text-center text-body text-foreground-secondary">
        Nothing matches.
      </p>
    );
  return (
    <ul aria-label={label} className="m-0 grid list-none gap-1 p-0">
      {shown.map((item) => (
        <li key={item.id}>
          <ListRow
            title={
              <span className="flex flex-wrap items-center gap-2">
                {item.title}
                {item.meta ? <Badge>{item.meta}</Badge> : null}
                {item.locked ? (
                  <Lock
                    aria-label={item.locked}
                    className="size-3.5 text-foreground-secondary"
                  />
                ) : null}
              </span>
            }
            description={
              item.description ? (
                <span className="line-clamp-2" title={item.description}>
                  {item.description}
                </span>
              ) : undefined
            }
            below={
              <>
                {item.below}
                {item.error ? (
                  <p className="m-0 mt-1 text-error text-xs">
                    {item.error.message}
                  </p>
                ) : null}
              </>
            }
            inline
            action={
              <Switch
                aria-label={item.title}
                checked={item.on}
                disabled={item.pending || Boolean(item.locked)}
                onCheckedChange={item.toggle}
              />
            }
          />
        </li>
      ))}
    </ul>
  );
}
