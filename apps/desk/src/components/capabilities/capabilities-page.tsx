"use client";

import {
  Input,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
  Toggle,
  ToggleGroup,
} from "@pythia/ui";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  CapabilityList,
  type Filter,
  useConnectors,
  usePlugins,
  useSkills,
  useTools,
} from "./capability-lists";

const TABS = ["skills", "tools", "connectors", "plugins"] as const;
type TabId = (typeof TABS)[number];
const LABELS: Record<TabId, string> = {
  skills: "Skills",
  tools: "Tools",
  connectors: "Connectors",
  plugins: "Plugins",
};
const LEADS: Record<TabId, string> = {
  skills:
    "Instructions Hermes can follow for a kind of task. Changes apply to new chats.",
  tools:
    "Toolsets Hermes can call in Pythia's chats. Pythia's own tools are always on; to stop a data source, switch off its plugin under Plugins. Settings shows what that takes away first.",
  connectors:
    "MCP servers that give Hermes more tools. Changes apply from the next session.",
  plugins:
    "Packages that add tools, providers and integrations to Hermes. Pythia's own plugin stays on.",
};

/**
 * What Hermes can do here, in one place, as Hermes Desktop's Capabilities
 * page does (apps/desktop/src/app/capabilities in NousResearch/hermes-agent,
 * MIT): skills, tools, MCP connectors and plugins, each searchable and
 * switched on or off in place.
 */
export function CapabilitiesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab: TabId = TABS.includes(requested as TabId)
    ? (requested as TabId)
    : "skills";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const lists = {
    skills: useSkills(),
    tools: useTools(),
    connectors: useConnectors(),
    plugins: usePlugins(),
  };
  const count = (id: TabId) => {
    const items = lists[id].items;
    return items.length
      ? ` ${items.filter((item) => item.on).length}/${items.length}`
      : "";
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-slot="capabilities">
      <div className="mx-auto grid max-w-4xl gap-4 px-4 pt-6 pb-28 sm:px-8 min-[900px]:pb-16">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            const next = new URLSearchParams(params);
            next.set("tab", value);
            router.replace(`${pathname}?${next}`, { scroll: false });
          }}
          className="grid gap-4"
        >
          <TabsList aria-label="Capabilities" className="flex flex-wrap gap-1">
            {TABS.map((id) => (
              <Tab key={id} value={id}>
                {LABELS[id]}
                <span className="text-foreground-secondary text-xs tabular-nums">
                  {count(id)}
                </span>
              </Tab>
            ))}
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 min-w-48 flex-1 items-center gap-2 rounded-control border border-border bg-raised px-2.5 text-foreground-secondary focus-within:border-border-strong">
              <Search aria-hidden="true" className="size-3.5 flex-none" />
              <Input
                aria-label={`Search ${LABELS[tab].toLowerCase()}`}
                placeholder={`Search ${LABELS[tab].toLowerCase()}…`}
                type="search"
                size="sm"
                className="min-h-0 border-0 bg-transparent px-0 focus-visible:outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <ToggleGroup<Filter>
              label="Show"
              className="gap-0.5 rounded-control p-0.5"
              value={[filter]}
              onValueChange={(value) => value[0] && setFilter(value[0])}
            >
              {(["all", "on", "off"] as const).map((value) => (
                <Toggle<Filter>
                  key={value}
                  value={value}
                  appearance="ghost"
                  size="sm"
                  className="h-7 px-2.5 font-normal text-body data-pressed:border-border data-pressed:bg-raised"
                  label={
                    value === "all" ? "All" : value === "on" ? "On" : "Off"
                  }
                />
              ))}
            </ToggleGroup>
          </div>
          {TABS.map((id) => (
            <TabPanel key={id} value={id} className="grid gap-3 p-0">
              <p className="m-0 text-body text-foreground-secondary">
                {LEADS[id]}
              </p>
              <CapabilityList
                loaded={lists[id]}
                filter={filter}
                query={query}
                label={LABELS[id]}
              />
            </TabPanel>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
