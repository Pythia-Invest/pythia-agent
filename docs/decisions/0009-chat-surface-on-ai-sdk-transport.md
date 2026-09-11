# 0009: Chat surface on the AI SDK transport seam

## Context

The rebuilt Desk needed its conversation window: history, streamed replies,
tool activity, approvals, and stop. Hermes is the harness today, but the
product may sit on another harness later, so the browser had to depend on a
stable seam rather than on Hermes event shapes. Three routes were weighed: a
full chat framework with primitives (assistant-ui), a headless streaming state
machine with our own components (Vercel AI SDK `useChat` and a custom
transport), and a hand-written reducer with no library.

## Ruling

- The browser conversation model is the AI SDK `UIMessage`. `Chat` and `useChat` from
  `@ai-sdk/react` own the live message list, status, and stream reconciliation.
  The browser provider retains one SDK Chat and transport per visited session
  for the page lifetime; route and dock views subscribe to that same instance.
  This is SDK object ownership, not a second durable session store. History comes from Hermes through the existing TanStack
  Query layer and seeds `useChat`.
- All Hermes knowledge in the browser lives in `src/client/hermes-transport.ts`,
  a `ChatTransport` that starts a run on Desk's own routes and maps the run's
  events to `UIMessageChunk`s through `src/client/hermes-run-mapper.ts`, plus
  `src/client/chat-message.ts`, which folds
  the Hermes transcript into `UIMessage`s. Swapping the harness means a new
  transport and history mapper; components do not change.
- Hermes-specific concepts that the SDK does not model natively are custom
  data parts: `data-approval` for run-level approvals with Hermes's four
  choices, and `data-run-status` for failure, cancellation, and disconnect.
  Failures render inline as parts rather than erroring the stream. Desk unwraps
  serialization and relay prefixes from Hermes's error string, then presents
  the innermost native message with the selected provider/model, an HTTP status
  when supplied, and a Retry action. It does not classify the cause or add
  diagnostic guidance.
- Every visible component is ours, built on `@pythia/ui` and Base UI:
  conversation viewport with follow-scroll and jump-to-latest, user bubbles,
  assistant prose, reasoning disclosure, tool rows, approval card, composer
  with Enter-to-send and Stop. Streamdown renders assistant markdown because
  it repairs incomplete markdown while streaming and sanitizes output.
- A new chat is created on the first prompt from the root surface; the prompt
  hands over to the session route through session storage, never the URL.

## Rationale

The AI SDK's transport interface is the harness boundary the product needs,
documented for exactly this use, while its parts model and status machine
remove the fiddly stream reconciliation from our code. Keeping the UI ours
preserves full control over the ChatGPT-style presentation and avoids a second
primitives library. assistant-ui would have added Radix, zustand, and a
pre-1.0 runtime abstraction beside TanStack Query; a hand-written reducer
would have re-implemented abort handling, tool states, and reconnection with
no external review.

## Consequences

`apps/desk` depends on `ai`, `@ai-sdk/react`, `zod` (peer), and `streamdown`.
Measured on the production build, the AI SDK client code is about 15 kB
gzipped; the shared chunk carrying Streamdown's markdown pipeline and zod is
about 175 kB gzipped. Conversation text (user bubbles, assistant
prose, the composer) is set at the compact 14px product reading size in Inter
through the `font-reading` role, the
single typeface exception the design direction allows; interface chrome stays
IBM Plex Sans. Regenerate is hidden
because Hermes sessions are append-only. Approvals bypass the SDK's boolean
approval helpers. Live-profile browser smoke tests cover history, the empty
state and composer gating without sending a prompt.

The transcript preserves assistant prose in chronological order. A later tool
call never reclassifies visible prose as reasoning. Tools, native reasoning
parts and answered approvals form one activity surface for the turn. While a
run is active, it is a non-interactive status line whose plain-language label
updates in place from the latest reasoning or tool event, such as `Searching
market news · 4s`; the accumulated log does not expand beneath it. Only that
line shows browser-observed elapsed time. Once the run settles, it becomes one
closed `Show details` disclosure whose body is a plain chronological list. It
uses no repeated reasoning headings, success checkmarks, vertical timeline
rail, raw input/output field grid, or nested tool disclosures.

This presentation follows the pinned source's actual capabilities. On
`/v1/runs`, `reasoning.available` contains up to 500 characters of ordinary
assistant content, including final responses; it is not the provider's
reasoning stream. While active, non-streamed preview content drives the same
live status line. It remains ordinary assistant prose if later work proves it
was interim commentary, while a terminal output replaces a final preview in
place. History supplies full assistant content and optional distinct reasoning
fields. Transcript timestamps are not execution-duration evidence.
Tool results and native call IDs come from history; the live API supplies only
names, previews, duration and error flags. Overlapping same-name calls remain
unconfirmed until history resolves them, rather than assigning outcomes by FIFO.
Unfinished tools never acquire success checkmarks merely because streaming ended.

`run.completed.output` is authoritative. Each streamed prose segment gets its
own SDK step, so the native `reset-step` chunk can replace incomplete or changed
final prose without removing earlier commentary or tools. After a completed
run, the query layer fetches native history and explicitly updates `useChat`:
its initial `messages` option does not reconcile subsequent query results.
A turn-generation guard and matching submitted users/final answer prevent a
late or incomplete read from erasing a newer turn. Observed approvals remain
visible when native history enriches the reply; failed reads keep the usable
streamed answer. Failed and disconnected turns are not replaced by a history
snapshot that would erase their outcome.

The activity line becomes the settled details disclosure as soon as ordinary
answer text starts streaming; the run need not be terminal first. The
conversation follows new tokens only while the reader remains at the bottom.
Scrolling upward detaches that follow behavior immediately and exposes an
explicit jump-to-latest control, so continued output does not pull the reader
away from earlier material.

Approvals show Hermes' redacted command, description and supplied choices. The
four native choices remain distinct; an absent choice list does not invent
permission to grant broader access. Inactive requests cannot be answered from
a finished turn.

The composer stays available while a run is active when the runtime advertises
`run_steer`. Submitted guidance goes to Hermes's native steer endpoint and is
shown as a user-authored note when the matching `run.steered` acknowledgement
arrives. Guidance returned as terminal `pending_steer` becomes the next user
turn, because Hermes accepted it after the prior answer had already settled.
The composer follows the pinned Hermes desktop interaction: while a run is
active, its single primary control shows Stop when the input is empty and
changes to Send when the user types steerable text. The acknowledgement is a
quiet system line, not another user bubble.

Desk discovers `run_steer` and `model_options` through the native capability
document. A compact picker passes only the qualified provider, model and
reasoning-effort fields to the next run and remembers the last browser choice.
Model and reasoning use two compact controls below and outside the bordered
composer input. The model control displays the selected value in a quiet
button. Its catalog behavior follows the pinned Hermes Desktop implementation:
configured providers are ordered alphabetically and identified at the right of
each compact row, models retain the backend's curated order, and the unfiltered list uses `featured_models` when supplied or
the first 50 models for a provider without that shortlist. The current model is
always included without moving its provider or row. Search spans the complete
configured native catalog and filters in place, regardless of the browser-local
visible shortlist. **Edit visible models** changes only that unfiltered
shortlist through provider tabs and whole-provider controls; newly discovered providers receive
the same native defaults until explicitly customized. Unavailable models remain
visible but disabled. Desk does not infer priority, price or opt-in status from
a model ID. Reasoning remains a separate select.

The pinned API server always publishes Hermes's normalized Mixture-of-Agents
example as an authenticated virtual provider. It neither distinguishes that
implicit example from an explicitly configured preset nor exposes the native
MoA configuration and progress surfaces used by Hermes Desktop. Desk therefore
excludes MoA from model discovery, search, and visibility settings instead of
presenting a preset whose readiness it cannot establish. The qualified
provider/model transport remains unchanged: an already stored MoA selection is
displayed and passed through until the user chooses another model, but its
ordinary reasoning-effort control is hidden because MoA reasoning belongs to
the preset's individual reference and aggregator slots. Selection normalization
also removes any generic effort left in browser storage by an earlier version.

Hermes remains the readiness authority. Desk does not probe providers, infer
credential sources, or derive provider health from a failed run. A failure
keeps Hermes's error message intact through the event stream and status-based
reconnection before the UI removes only transport wrappers for presentation.
Only the server-side Hermes bearer is mechanically redacted if an upstream
response echoes it. Retry is available only on the latest failed turn, while idle, and repeats
that turn with the selected model; Desk
never silently falls back to another provider. The transport retains the selected model and native run token totals as SDK
message metadata. The current answer action row exposes copy and Sources; it
does not display response metadata.

The active run identifier is held in session storage for reconnection, never as
a second session or run authority. Reloading the page verifies native run
status before subscribing to events. Hermes's pinned run stream consumes a
single queue and removes it when the subscriber exits; it has no replay or
broadcast contract. Desk therefore never opens another reader on a view
remount. During an active run, bounded-interval native status reads recover
terminal output and pending approvals even if the stream stalls or disappears.
A missing queue is a connection problem, never a synthetic run failure. After
three consecutive status failures Desk reports disconnection and retains the
run identifier. Only explicit Stop asks Hermes to cancel: Stop waits for any
pending create-run response, sends the native stop request, and continues
observing until native terminal status. A rejected stop leaves observation
active and shows the backend error.

This lifetime also keeps completion enrichment and accepted pending guidance
working when the chat is hidden. Rejected in-run guidance remains in the
composer for correction or retry. Older history is explicitly prepended to the
SDK message list at an existing native-row overlap, preserving its live
tail and the reader's anchor. Each folded UI message retains its native row
IDs: pagination can begin inside an assistant/tool sequence, so a UI message
ID alone is not a reliable overlap. Loading an earlier page completes that
boundary turn instead of duplicating or dropping it. Terminal recovery merges
an already hydrated answer by native row identity while retaining observed
approval decisions; equal answer text alone never removes an earlier turn. A fresh SDK instance for every placement and
independent replayable SSE fixtures were rejected because both violate the
pinned queue contract.

History requests use explicit newest-first pagination. Older native pages are
prepended on request while preserving the reader's scroll anchor. Delegation
events enrich the one process disclosure with child goal, status and duration;
the surface does not expose child output tails or represent them as evidence.
Completed answers provide copy controls and collect only explicit final-answer
links into a compact anchored Sources panel, avoiding a transcript layout shift.
Tool calls are never converted into citations.

The rationale is a stable reading surface with inspectable evidence of work.
Rejected alternatives are retrospectively folding prose into "thinking",
inferring reasoning or duration from event names and insertion timestamps,
assigning successful outcomes to unfinished work, and rebuilding stream state
outside the installed SDK. Also rejected are filtering a particular MoA preset
name, parsing profile configuration in Desk, and treating the virtual
provider's `authenticated` flag as evidence that every preset slot is ready.
Provider-free synthetic browser tests intercept all
Desk APIs and exercise stream progression, reconciliation, approvals and
interruption on desktop and phone viewports; ordinary live-profile smoke tests
continue to avoid creating sessions or sending prompts.

Follow-ups recorded, not decided: the `@pythia/ui` barrel import costs about
200 kB gzipped in the shell chunk and should be tree-shaken or split;
Streamdown's weight should be re-checked against a plain react-markdown setup
once the surface stabilizes.

## Rejected alternatives

assistant-ui with `ExternalStoreRuntime` (rich primitives and thread list, but
Radix and zustand at runtime, weekly 0.x releases, `unstable_` tool APIs, and a
second state layer); AI Elements (bound to shadcn/Radix); CopilotKit and
similar agent-state frameworks (another control plane); a hand-rolled reducer
(cheapest install, most code to own for abort, tool states, and reconnect).

File and image input extends this transport through standard AI SDK file parts
and native structured Hermes user content; storage and retention are defined
in [ADR 0010](0010-local-chat-attachments.md).


The shell's desktop dock remains a resizable side panel. Below 900px it opens
only on request in the shared modal Drawer, preserving access to the routed
page. Mobile navigation stacks its existing rail and chat list within the
viewport. Projects are omitted: the in-memory grouping had no durable native
Hermes owner and implied a capability it could not preserve. Pins and native
session history remain the supported chat organization; a parallel project
store was rejected.

Mobile navigation uses the shared modal Drawer for focus containment, Escape
and restoration to its trigger. The dock uses shared Tabs for roving focus,
arrow activation and panel associations; these primitives retain the existing
rail, chat-list and tab-strip appearance. Open chat IDs remain in the strip
even when absent from the bounded session list; missing list metadata uses a
fallback title rather than hiding a valid transcript.

Model-family collapsing applies only to default shortlist construction and
visibility editing. Search enumerates exact native model IDs, and the current
ID remains visible even when it is a fast sibling or dated snapshot. Hermes
Desktop exposes variant controls alongside its collapsed families; hiding
variants without those controls was rejected. Desk preserves the compact
selector by making variants directly searchable instead of adding a submenu.

The empty-chat invitation and composer are centered together in their available
column, with scrolling on short screens. The desktop navigation rail is part
of server-rendered markup and uses CSS for viewport visibility; waiting for a
client media query before inserting it caused a refresh layout shift. The
mobile copy stays inside the native modal Drawer. Theme selection belongs to
Settings; the rail has no duplicate theme toggle.

User messages are right-aligned bubbles within the reading column; assistant
prose and system notes share its left edge. Completed answer actions remain
visible for every answer, inset from the text edge, with compact icons and
spacing. Run progress belongs in the transcript, not beside Submit. The
14px product reading size is retained; tighter paragraph and turn spacing
provides density without reducing body readability. Full-width user cards,
hover-only historical actions and duplicated composer phase labels were
rejected following user review.

Docked chat tabs share the available width equally, capped at 200px. Selection
and title length do not change their width; the unsaved New chat tab follows
the same rule. Below a 96px readable width, additional chats move into the
existing overflow menu while the active chat remains visible; visible tabs stay
at that minimum so adding another chat cannot enlarge the remaining tabs. This adapts
[Chromium's capped shared-width layout](https://github.com/chromium/chromium/blob/main/chrome/browser/ui/views/tabs/tab_strip_layout.cc)
to the narrower research dock. Active-tab expansion and inactive icon-only
tabs were rejected because switching conversations shifted their targets.

Native `reasoning.available` previews can repeat the first 500 characters of
already streamed assistant content. Desk recognizes that prefix and promotes
terminal previews to ordinary answer text even when the final output is equal.
An idle retained chat can append newer native turns after its last native row
anchor. In-flight and unpersisted local tails are preserved, as are loaded older
pages and observed approval/failure details. Settings retains the native
credential, skills/toolsets and update-status adapters in its section layout;
server mutation, credential custody and restart/readback ownership are unchanged.
