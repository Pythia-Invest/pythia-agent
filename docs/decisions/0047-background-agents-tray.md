# 0047: Background agents tray

## Context

Hermes runs delegated research agents in the background: a top-level
`delegate_task` returns at once, and the child keeps working after the parent's
turn ends. Desk showed a chat's agents inside the turn that started them, so
once that turn scrolled away, or after the reply said "the results will appear
here", nothing in the chat said what was still running or had just finished.

A first version put a cross-chat entry in the navigation rail. In use it was
easy to miss, and research agents are followed from the chat that asked for
them, as Claude shows background tasks inside the conversation.

The pinned Hermes gives each `source=subagent` child `started_at`,
`last_active` and `ended_at`. It has no HTTP call that lists active delegations
or stops a single child: `delegate_task`'s `stop` runs inside the parent's turn,
and the child registry is reachable only from Hermes's terminal UI. Stopping a
parent run does not stop its background children. Every child's `end_reason` is
`agent_close`, whatever happened, so Hermes records no outcome to show.

## Ruling

The chat window carries a tray on the composer's top edge for that chat's
research agents. It appears while an agent works, has gone quiet (not ended,
active within two hours), or finished in the last 30 minutes. Collapsed, it is
one line of counts ("Research agents: 2 running · 1 finished"). Expanded, it
opens upward into the agents with their native task text and time: elapsed
while working, time since last activity when quiet, time since ending when
finished. Choosing one opens that agent's conversation, as the turn's agent rows
already do.

The tray reads the chat's existing native work projection; each child carries
its native `started_at` and `last_active`. It is read-only: no stop, steer or
retry controls, and a finished agent reads as ended, never as succeeded or
failed. Only research agents appear; background terminal commands are not
listed.

## Rationale

People follow delegated work from the conversation that asked for it, and the
composer is where their attention returns while waiting. A tray there stays
visible as the transcript scrolls, costs one line, and disappears when nothing
is running. Reading the chat's own work projection adds no request and no
second store. Leaving out a stop control keeps Desk a faithful Hermes interface:
the only native way to stop a child is to ask its parent, which the chat already
allows.

## Consequences

The touchpoint index records the fields the tray reads and the absence of a
child stop. If a future pin exposes delegation status or child interruption over
HTTP, a stop control and real outcomes become possible. Agents in other chats
are not shown outside those chats. Times are only as precise as Hermes's native
timestamps.

## Rejected alternatives

A cross-chat entry in the navigation rail (built first, then replaced: easy to
miss and separated from the conversation); an always-visible tasks area (adds
chrome when nothing runs); a Desk-side registry or stop queue for agents (a
second control plane over Hermes); stopping the parent run to stop its agents
(Hermes does not propagate that to background children, so the control would
not do what it says).
