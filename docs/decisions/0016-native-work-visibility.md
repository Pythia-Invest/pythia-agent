# 0016: Native work visibility in Desk

## Context

A single replacing status line hid the sequence of research activity. Hermes
already owns plans and delegated agents, but Desk exposed little of their state.
Users need to inspect that work without reading tool payloads or adopting a
second task-management system. The pinned HTTP run API is narrower than
Hermes's desktop gateway: it forwards parent tools and child lifecycle events,
but omits child tool/text streams and dedicated todo updates.

## Ruling

Each assistant turn opens with one quiet activity line. While Pythia works it
is a single present-tense sentence that updates in place ("Searching the web",
"Reading report.md", "Waiting for your approval"), falling back to Thinking
only after a short hold so quick steps do not blink. Commentary and reasoning
previews never become the status; they live in the turn's record. When
answer prose begins, the line settles to Worked for 2m 4s (or Worked when no
duration is known). This is an explicitly chosen presentation heuristic, not a
claim that the text is final: Hermes exposes no reliable answer-start phase.
Renewed tool work after prose brings the live line back without opening
anything. Streamed prose has its own keyed reading surface from its first
token, so completion never moves the answer between containers. Guidance sent
mid-run closes the segment before it; each segment keeps its own line.

Following the investor's explicit Hermes Desktop reference, a fixed-size amber
breathing dot in the margin marks a live line; this is the one approved
exception to the signal-only amber rule (docs/design.md). Nothing opens
automatically. Choosing the line opens the turn's record inline: commentary
and reasoning notes, one plain-language row per visible tool, approvals as
"You allowed a command once", the latest plan, and the turn's agents. A
reader's opened record stays open through answering and completion. Tool rows
keep running, completed, unconfirmed and failed distinctions and open to
details a reader can use: search results and pages as links, code with its
output, files by name, a failure's reason, or at least what the step was asked
to do. Raw result bodies are not the interface, and inspecting a row does not
fetch more history. Internal plumbing (tool catalogue lookups, skill loading,
reading agents' own logs, delegation and plan calls) has no row. Missing
evidence never becomes a success or a native failure.

While the run is live, the current native plan and the turn's research agents
sit directly under the live line; once the turn settles they move into its
record. A turn lists up to three agents under the live line and up to five in
the record ("Asked 3 research agents to help"); "and N more" opens the Research
agents directory for the whole chat. Agents are tied to a turn by their native
identity or exact delegated task, never by similar wording or the session's
whole swarm. Delegation calls describe what they do to agents: starting,
checking, redirecting or stopping them.

Selecting an agent replaces the main conversation with the child's, on both
wide and narrow screens, with a compact header: Back to chat and the child's
state (working, status unknown, finished, stopped early, stopped with an
error). The child view reuses the main chat's turns, activity, Markdown and
scroll behavior. Its opening bubble is labelled Task; uniquely matched
delegation context sits in a Background it was given disclosure. The native
assignment row's ID prevents duplicating that bubble when its page loads. The
parent ChatSession and its consuming run stream stay alive while its
transcript is replaced; the parent composer stays mounted but hidden,
preserving drafts and uploads without implying that messages can be sent to a
child. Returning restores the parent reading position, including replies that
arrived meanwhile. Child inspection has no controls to steer or stop
individual children in this slice.

Directory rows lead with the task's first sentence, without the "as of"
date stamp parents add, followed by a short distinguishing native ID; full
text is available on hover and in the assignment. Every row carries a small
labelled status icon (a spinner while working), so silence never implies
success. No extra model call generates a
label. Search matches loaded titles, tasks and IDs. One status filter offers
All agents, Working, Finished and Status unknown. Unknown status remains
explicit; parent completion does not move it into Finished. Completed, stopped,
failed and ended agents retain their individual outcomes. Finishing does not
remove their saved conversations or responses.

Rows keep their first-observed order within the chat rather than jumping as
last activity or status changes. The directory renders at most 25 matching
rows per page; filtering applies across all loaded summaries. Selection, search,
filter, list position and pagination survive switching agents and closing the
directory.
The last 50 visited child reading positions are transient view state. Only the
selected transcript is mounted; navigation does not keep a swarm of queries or
message renderers alive. This supports large groups without adding a second
session authority or a navigation tab per agent.

Plans come only from successful native todo result snapshots. The latest
snapshot is shown in native order with pending, in-progress, completed and
cancelled states; it replaces earlier ones rather than listing their changes.
Clearing a plan is an explicit empty snapshot, not a failed request or missing
page: a cleared plan disappears, historical todo calls do not keep an empty
list visible, and a later nonempty native snapshot shows it again.
Completion of the parent run never checks unfinished tasks.

One existing SDK Chat continues to own the consuming run stream. Child lifecycle
records are independent of the delegate tool's lifetime and survive completed
history reconciliation. Plan/agent reads use admitted Desk routes and TanStack
Query; there is no direct product SQLite reader, persistent activity store,
second subscriber, inference-based summarizer, or additional gateway.

## Consequences and limits

Work reads are bounded pages of 200 native messages and 200 subagent session
summaries. Hermes has no parent-session query filter, so filtering occurs after
the native source-filtered page; Load more agents in the directory explicitly
continues the bounded reads. Counts describe loaded agents, and
incomplete discovery explicitly says search covers loaded agents. Absence from
a recent page does not establish absence from a chat.
This first version discovers and inspects direct children of the selected
conversation; recursive descendants and compacted parent lineages are not
reconstructed.
Initial reads and relevant todo/delegation
stream changes refresh the recent window; while the run or an agent is working,
or the directory or an agent's conversation is open, only that window is polled
every five seconds. While any agent's outcome is unconfirmed (status unknown),
it is checked every 30 seconds instead: a background child's completion rarely
reaches the parent's run stream, and polling stops once no agent is unconfirmed. Older pages are loaded on demand and are
not rescanned by interval polling or ordinary live updates.
The recent-window query cache retains up to 32 observed plan snapshots and 200
agent/assignment records so work does not vanish when a recent-history window
advances. These are bounded native observations, not a second task authority.

Only a selected child's activity is polled, every two seconds while it may be
active, with slower retries after errors and no background-tab interval polling.
Its initial assignment and latest 100-message page come from native history;
earlier activity is explicit pagination. Calls/results in the ordinary Hermes
loop persist incrementally, including codex_responses. Other runtime modes may
save later; this is saved-step visibility, not guaranteed child token streaming.
Polling and completion respect the same reader-controlled following behavior as
the main chat, including Jump to latest.
Neither a missing completion event nor a saved session's ended_at proves success:
unknown live status and an ended session are labelled separately from an explicit
completed/failed/stopped event.

The HTTP event called reasoning.available is a shortened assistant-content
preview, not a private reasoning stream. Direct child steering and true child
text/reasoning streaming remain unavailable on this integration. Their native
in-process/desktop equivalents do not authorize another gateway to control HTTP
runs. A future native HTTP extension should be qualified before adopting them.

## Rejected alternatives

Keeping only the latest status hides useful work. Exposing raw tool JSON makes
developer diagnostics the user interface. Inferring plans or task completion
creates a competing authority. Launching Hermes's desktop gateway beside the
HTTP runtime does not share its live child registry and adds unnecessary runtime
ownership. Changing model-writing instructions is unrelated to rendering work.
A separate inspector-style transcript duplicates chat behavior and makes a
delegated conversation harder to recognize; sharing the chat surface keeps both
reading experiences consistent without adding another execution path.
The earlier popover-to-drawer flow hid neighboring agents and reset navigation.
A large list/detail drawer preserved that context but duplicated the chat space
and overwhelmed the screen. Compact Plan and Agents controls above the composer,
with a searchable switcher, were tried next; they separated plans and agents
from the turn that produced them and added chrome to every chat. Showing them
with their turn, and the directory only for large groups, keeps the
inspection without another standing control.
Automatically sorting rows on every status update, loading all transcripts,
generating per-agent labels, and rendering hundreds of navigation tabs add cost
or instability without helping this basic inspection workflow.

An accumulating feed of about five live lines with elapsed time, collapsing as
prose began, showed more motion than a reader could follow and competed with
the answer. The prior completion-only presentation streamed answer text inside
the activity rail and remounted it outside on completion, causing visible
jumps. Keeping that
layout and adding only a fade would preserve the structural problem. Treating
first text as proof of completion would misrepresent resumed tool work; the UI
therefore separates presentation collapse from native run completion.
