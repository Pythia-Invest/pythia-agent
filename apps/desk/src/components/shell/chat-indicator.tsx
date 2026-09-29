import { MessageCircle } from "lucide-react";

/** One quiet status slot; active work takes precedence over an unread reply. */
export function ChatIndicator({
  working = false,
  unread = false,
  idleIcon = false,
}: {
  working?: boolean;
  unread?: boolean;
  idleIcon?: boolean;
}) {
  if (working)
    return (
      <span
        data-slot="chat-indicator"
        role="img"
        aria-label="Working"
        title="Working"
        className="grid size-3.5 shrink-0 place-items-center"
      >
        {/* The same amber cue the working turn shows: Pythia is on it. */}
        <span className="size-2 rounded-pill bg-signal motion-safe:animate-breathe" />
      </span>
    );
  if (unread)
    return (
      <span
        data-slot="chat-indicator"
        role="img"
        aria-label="Unread reply"
        title="Unread reply"
        className="grid size-3.5 shrink-0 place-items-center"
      >
        <span className="size-1.5 rounded-pill bg-info" />
      </span>
    );
  return idleIcon ? (
    <MessageCircle
      aria-hidden="true"
      data-slot="chat-indicator"
      className="size-3.5 shrink-0 stroke-[1.6] text-foreground-secondary"
    />
  ) : null;
}
