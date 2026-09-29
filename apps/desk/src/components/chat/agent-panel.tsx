"use client";

import { Dialog } from "@pythia/ui";
import { X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { useWork } from "@/client/queries";
import type { WorkAgent } from "@/work/types";
import { AgentList, type AgentNavigation } from "./agent-list";
import { agentIdentifiers } from "./agent-presentation";

/**
 * Every research agent in the chat, for when a turn lists only its first few.
 * Search, status filter and paging keep a swarm of hundreds navigable.
 */
export function AgentDirectory({
  agents,
  selected,
  onSelect,
  open,
  onOpenChange,
  query,
}: {
  agents: WorkAgent[];
  selected: string | undefined;
  onSelect: (agent: WorkAgent) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: ReturnType<typeof useWork>;
}) {
  const [navigation, setNavigation] = useState<AgentNavigation>({
    search: "",
    filter: "all",
    page: 0,
  });
  const listScroll = useRef(0);
  const order = useRef(new Map<string, number>());
  const ordered = useMemo(() => {
    // Native activity/status changes must not move rows underneath the reader.
    for (const a of agents)
      if (!order.current.has(a.id)) order.current.set(a.id, order.current.size);
    return [...agents].sort(
      (a, b) => (order.current.get(a.id) ?? 0) - (order.current.get(b.id) ?? 0),
    );
  }, [agents]);
  const identifiers = useMemo(() => agentIdentifiers(ordered), [ordered]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup
            className="flex h-[min(34rem,calc(100dvh-2rem))] w-[min(30rem,100%)] flex-col overflow-hidden p-0"
            data-slot="agent-directory"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3">
              <Dialog.Title className="m-0 font-medium text-body">
                Research agents
              </Dialog.Title>
              <Dialog.Close aria-label="Close">
                <X aria-hidden="true" className="size-4" />
              </Dialog.Close>
            </div>
            <AgentList
              agents={ordered}
              identifiers={identifiers}
              selected={selected}
              navigation={navigation}
              onNavigate={setNavigation}
              onSelect={(agent) => {
                onSelect(agent);
                onOpenChange(false);
              }}
              scroll={listScroll}
              loading={query.isPending}
              incomplete={Boolean(query.data?.pages.at(-1)?.agentsMore)}
              loadingMore={query.isFetchingNextPage}
              error={query.isError}
              onRetry={() => void query.refetch()}
              onLoadMore={() => void query.fetchNextPage()}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
