"use client";

import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeskUIMessage } from "@/client/chat-message";
import { useWork } from "@/client/queries";
import { useChatReading } from "@/client/use-chat-attention";
import { workRevision, workState } from "@/client/work-state";
import type { WorkAgent } from "@/work/types";
import { AgentDirectory } from "./agent-panel";
import { agentFinished } from "./agent-presentation";
import { AgentDetail } from "./agent-work";
import type { ConversationPosition } from "./conversation";
import { TurnWork } from "./turn-work";

/** Navigation changes only the reading surface; ChatSession keeps the parent run alive. */
export function ChatWork({
  sessionId,
  messages,
  busy,
  conversation,
  composer,
}: {
  sessionId: string;
  messages: DeskUIMessage[];
  busy: boolean;
  conversation: (
    position: ConversationPosition,
    onAtLatestChange: (atLatest: boolean) => void,
  ) => ReactNode;
  composer: ReactNode;
}) {
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const [agentsWorking, setAgentsWorking] = useState(false);
  const [selected, setSelected] = useState<{
    agent: WorkAgent;
    position: ConversationPosition;
  } | null>(null);
  useChatReading(sessionId, !selected, atLatest);
  const back = useRef<HTMLButtonElement>(null);
  const mainPosition = useRef<ConversationPosition>({
    top: 0,
    following: true,
  });
  const positions = useRef(new Map<string, ConversationPosition>());
  // Watch native work while anything is moving: the run, its background
  // agents, or an agent conversation someone is reading.
  const query = useWork(
    sessionId,
    workRevision(messages, busy),
    busy || agentsWorking || agentsOpen || Boolean(selected),
  );
  const state = useMemo(
    () => workState(query.data?.pages ?? [], messages, busy),
    [query.data, messages, busy],
  );
  useEffect(() => {
    setAgentsWorking(state.agents.some((agent) => !agentFinished(agent)));
  }, [state.agents]);
  const agent =
    state.agents.find((a) => a.id === selected?.agent.id) ?? selected?.agent;
  const plan = busy && state.plan?.items.length ? state.plan.items : undefined;
  const select = (next: WorkAgent) => {
    const position = positions.current.get(next.id) ?? {
      top: 0,
      following: true,
    };
    positions.current.delete(next.id);
    positions.current.set(next.id, position);
    // Retain only recently visited reading positions, never a swarm of transcripts.
    if (positions.current.size > 50) {
      const oldest = positions.current.keys().next().value;
      if (oldest) positions.current.delete(oldest);
    }
    setSelected({ agent: next, position });
    requestAnimationFrame(() => back.current?.focus({ preventScroll: true }));
  };
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-slot="chat-work"
      aria-label={agent ? "Research agent conversation" : "Main conversation"}
    >
      {agent ? (
        <Fragment key={agent.id}>
          <AgentDetail
            agent={agent}
            sessionId={sessionId}
            assignments={state.assignments}
            position={selected?.position ?? mainPosition.current}
            backRef={back}
            onBack={() => setSelected(null)}
          />
        </Fragment>
      ) : (
        <TurnWork.Provider
          value={{
            agents: state.agents,
            plan,
            onSelectAgent: select,
            onShowAllAgents: () => setAgentsOpen(true),
          }}
        >
          {conversation(mainPosition.current, setAtLatest)}
        </TurnWork.Provider>
      )}
      <AgentDirectory
        agents={state.agents}
        selected={agent?.id}
        onSelect={select}
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        query={query}
      />
      {/* Keep drafts, uploads and send state mounted, but never imply child messaging. */}
      <div
        hidden={Boolean(agent)}
        className="flex-none @[48rem]/chat:px-6 px-4 pb-2.5"
      >
        {composer}
      </div>
    </section>
  );
}
