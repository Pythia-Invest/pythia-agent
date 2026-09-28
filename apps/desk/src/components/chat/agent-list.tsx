"use client";

import {
  Button,
  Input,
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@pythia/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { WorkAgent } from "@/work/types";
import {
  AGENT_FILTERS,
  AGENT_PAGE_SIZE,
  type AgentFilter,
  agentName,
  agentTitle,
  matchingAgents,
} from "./agent-presentation";
import { AgentMark } from "./activity-rows";

export type AgentNavigation = {
  search: string;
  filter: AgentFilter;
  page: number;
};

export function AgentList({
  agents,
  identifiers,
  selected,
  navigation,
  onNavigate,
  onSelect,
  loading,
  incomplete,
  loadingMore,
  error,
  onRetry,
  onLoadMore,
  scroll,
}: {
  agents: WorkAgent[];
  identifiers: Map<string, string>;
  selected: string | undefined;
  navigation: AgentNavigation;
  onNavigate: (next: AgentNavigation) => void;
  onSelect: (agent: WorkAgent) => void;
  loading: boolean;
  incomplete: boolean;
  loadingMore: boolean;
  error: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  scroll: RefObject<number>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const { search, filter } = navigation;
  const matches = matchingAgents(agents, filter, search);
  const page = Math.min(
    navigation.page,
    Math.max(0, Math.ceil(matches.length / AGENT_PAGE_SIZE) - 1),
  );
  const start = page * AGENT_PAGE_SIZE;
  const change = (next: AgentNavigation) => {
    if (viewport.current) viewport.current.scrollTop = 0;
    scroll.current = 0;
    onNavigate(next);
  };
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = scroll.current;
  }, [scroll]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="agent-list">
      <div className="grid shrink-0 gap-1 px-3 pt-3 pb-2">
        <Input
          aria-label="Search agents"
          type="search"
          placeholder="Search agents…"
          value={search}
          onChange={(e) =>
            change({ ...navigation, search: e.target.value, page: 0 })
          }
        />
        <Select
          value={filter}
          onValueChange={(value) => {
            if (value && value in AGENT_FILTERS)
              change({ ...navigation, filter: value as AgentFilter, page: 0 });
          }}
        >
          <SelectTrigger
            aria-label="Agent status"
            appearance="inline"
            className="justify-self-start text-foreground-secondary"
          >
            <SelectValue>{AGENT_FILTERS[filter]}</SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectPositioner align="start" className="z-70">
              <SelectPopup>
                <SelectList>
                  {Object.entries(AGENT_FILTERS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectList>
              </SelectPopup>
            </SelectPositioner>
          </SelectPortal>
        </Select>
      </div>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        data-slot="agent-list-viewport"
        onScroll={(e) => {
          if (e.currentTarget.clientHeight)
            scroll.current = e.currentTarget.scrollTop;
        }}
      >
        <ul className="m-0 grid list-none p-0" aria-label="Agents">
          {matches.slice(start, start + AGENT_PAGE_SIZE).map((agent) => (
            <li key={agent.id} className="min-w-0">
              <button
                type="button"
                aria-current={selected === agent.id ? "true" : undefined}
                data-agent-id={agent.id}
                title={agentName(agent)}
                className="motion-fast group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 text-start text-body transition-colors hover:bg-interaction-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 aria-current:bg-interaction-active"
                onClick={() => onSelect(agent)}
              >
                <AgentMark status={agent.status} />
                <span
                  className="min-w-0 flex-1 truncate text-foreground-secondary group-hover:text-foreground"
                  data-slot="agent-topic"
                >
                  {agentTitle(agent)}
                </span>
                <span
                  className="numeric shrink-0 text-foreground-disabled text-xs"
                  data-slot="agent-identity"
                >
                  {identifiers.get(agent.id)?.replace(/^Agent /u, "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!matches.length ? (
          <p className="px-3 text-body text-foreground-secondary">
            {loading
              ? "Loading agents…"
              : search || filter !== "all"
                ? "No matching agents."
                : "No agents in the loaded work."}
          </p>
        ) : null}
      </div>
      {matches.length > AGENT_PAGE_SIZE || error || incomplete ? (
        <div className="grid shrink-0 gap-2 border-border border-t p-3 text-foreground-secondary text-xs">
          {matches.length > AGENT_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-2">
              <span>
                {start + 1}–{Math.min(start + AGENT_PAGE_SIZE, matches.length)}{" "}
                of {matches.length}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Previous agents"
                  disabled={page === 0}
                  onClick={() => change({ ...navigation, page: page - 1 })}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Next agents"
                  disabled={start + AGENT_PAGE_SIZE >= matches.length}
                  onClick={() => change({ ...navigation, page: page + 1 })}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="status" className="m-0">
              Could not refresh agents.{" "}
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={onRetry}
              >
                Try again
              </button>
            </p>
          ) : null}
          {incomplete ? (
            <div className="grid gap-2">
              <span>
                More agents may be available. Search covers loaded agents.
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                disabled={loadingMore}
                onClick={onLoadMore}
              >
                {loadingMore ? "Loading…" : "Load more agents"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
