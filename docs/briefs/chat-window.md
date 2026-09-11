# Pythia chat window — design requirements

Audience: product designer and frontend implementer. Handoff date: 9 September 2026.

This is the brief for the first-version chat experience over Pythia's pinned,
unmodified Hermes runtime, v2026.8.31. It consolidates existing product decisions;
it is not a request to expose every Hermes configuration option in the composer.
“Supported” means the current integration has the necessary contract, not that
every visual state is already finished or every model supports the capability.

## 1. Product goal and design authority

Build a calm, compact research conversation: easy to ask, easy to follow while
work happens, comfortable to read, and possible to inspect when something needs
explanation. Use familiar chat interaction patterns, with Pythia's own design
system. The input and the answer should command attention; runtime controls and
activity should remain secondary.

Use [design.md](../design.md) for visual direction and existing `@pythia/ui`
components/Design Lab for component foundations. Do not create a second design
system for chat. Use IBM Plex Sans for interface chrome and Inter for the
composer and conversation. The accepted chat reading baseline is 14px, rather
than making all chat content 16px. Exact responsive treatment belongs to the
designer, subject to legibility and accessibility.

Use neutral surfaces, fine borders, restrained icons, clear hierarchy, and both
light and dark themes. Avoid excessive cards, decorative timelines, gratuitous
badges, gradients, oversized controls, or terminal-like density. Signal Amber
is reserved for an actual Pythia signal, not general selection, focus or progress.

## 2. Main workflows

The empty invitation and composer are centered together horizontally and
vertically within the available chat column. User messages sit in right-aligned
bubbles; assistant prose and system notes use the left reading edge. Keep the
spacing between turns compact. The desktop navigation rail reserves space from
first paint, including before hydration. Theme selection lives in Settings.
Projects are excluded from this version; organize native chats with history and
pins instead. Show live progress in the transcript, without repeating phase
labels beside Submit.

The design must accommodate these without requiring users to understand Hermes:

1. Open New chat, immediately type, and send with the current model.
2. Attach documents or an image, ask a question, and inspect the resulting answer.
3. See the latest meaningful activity during a long research task.
4. Read earlier content while an answer continues streaming.
5. Add direction while work is running, when Hermes supports it.
6. Inspect an approval request, understand the requested action, and allow or deny it.
7. Recover from an upload failure, model error, interruption, or lost connection.
8. Reopen a conversation and inspect its answers, attachments, sources and work details.
9. Occasionally change model/effort or manage the visible model shortlist.

## 3. Layout, navigation and stability

- Provide a left navigation area with a clickable Pythia wordmark, New chat,
  pinned conversations and recent conversations. Collapse navigation on narrow
  screens. Pins are a browser-local preference, not a Hermes session property.
- Both the wordmark and New chat open the empty chat surface and focus the input.
  Merely opening that surface does not create an empty Hermes conversation.
- Give the transcript a readable measure and the composer a predictable location.
  User messages, assistant prose, activity, approvals and errors must be distinct
  without wrapping every element in a large card.
- Keep the empty-state heading and background stable when the input grows.
  Reserve space for model/effort controls while their data loads. Uploads and
  errors may add necessary content but must not cause unrelated elements to jump.
- The textarea grows to a bounded height and then scrolls internally. Preserve
  access to attachments, Send/Stop, and selectors with the mobile keyboard open.
- Show history loading, an empty history, a history-load failure and retry, and
  loading older messages. Prepending older messages preserves the reading position.

## 4. Composer

- Multiline input; Enter sends, Shift+Enter inserts a newline. IME composition
  must not accidentally send. Keep a visible, accessible Send action.
- Support text-only, attachment-only, and mixed messages. Prevent duplicate
  submissions and sending an empty message.
- Do not send until every included attachment has uploaded successfully and
  limits are satisfied. A failed upload remains visible with Retry and Remove.
- Preserve the draft when an upload or pre-send operation fails. Once sent,
  the submitted message and its attachment references belong to the transcript.
- Put the paperclip action in the input area. Model and reasoning controls are
  **below and outside the bordered input**, in one quiet, compact control row.
- Model/effort changes apply to the next submitted run. Do not imply that choosing
  another value changes a run already in progress; show unavailable controls
  consistently while a run locks them.

When a run is active, use Hermes Desktop's established primary-action behavior:
an empty input shows Stop; typed text shows Send if steering is available. Make
the placeholder/action meaning clear, for example “Add direction while Pythia
works.” If steering is unavailable, do not present typed text as sendable guidance.

## 5. Activity, reasoning and answer streaming

These are three different concepts:

| Concept | Meaning | Required treatment |
| --- | --- | --- |
| Reasoning effort | A request setting controlling the model's reasoning behavior | Separate compact selector; not a progress indicator |
| Live activity | Observable tool work or commentary exposed by Hermes | One updating line during work |
| Recorded reasoning | Optional, distinct reasoning content returned in history | Inspectable detail only when actually supplied |

### Before the answer starts

- Show one live activity position that updates to the latest useful event:
  “Searching company filings,” “Reading report.pdf,” or a supplied commentary
  preview. Use neutral fallback copy while no meaningful event is available.
- Show restrained motion and elapsed time with stable alignment and numeric
  width. Do not show a percentage or completion estimate without real evidence.
- Do not continuously append large tool outputs or repeated “Reasoning” headings.
  Do not hide all activity behind a closed disclosure while the user is waiting.
- Represent overlapping tasks honestly: the latest line is the latest observable
  update, not a claim that it is the only work running.

### As the answer starts

- As soon as ordinary answer text starts streaming, replace the live line with
  the compact, initially closed details disclosure used for the settled turn.
  Do not wait for the whole run to finish.
- Stream prose in its normal reading position. Already visible commentary must
  not jump into a “thinking” box when a later tool call arrives.
- Keep the run's actual completion state distinct from the activity disclosure's
  collapsed appearance. More work can still occur after prose has begun.

### Afterward

- Provide one “Show details” disclosure per assistant turn. Its contents form a
  plain chronological account of supplied reasoning, tool work and answered
  approvals. Avoid nested disclosure trees and an ornamental vertical rail.
- Disclose failed, interrupted or unconfirmed work where relevant. No blanket
  success checkmarks just because the answer ended.
- Do not manufacture reasoning, rewrite activity as private thoughts, or display
  an empty reasoning section for models that supply none.

**Hermes constraint:** the current live `reasoning.available` event contains a
preview of ordinary assistant content, including possible final-answer content.
It is not a live provider reasoning stream. Distinct reasoning fields may appear
in stored history. The design must never imply access to a full private thinking
trace or invent reasoning to fill this gap.

## 6. Tools, delegated work and approvals

### Tool details

Present the task in human language first, with enough target context to explain
it: source, query, document name or operation. Preserve native tool names,
arguments and results as inspectable technical detail where supplied. Unknown
tools need a readable fallback, so new Hermes/MCP tools do not require a new UI.

Design running, completed, failed and unconfirmed/interrupted states. Do not
equate successful execution with factual correctness. Keep large results bounded
and readable; arbitrary JSON should not dominate the normal transcript.

Live events supply tool names, previews and some completion information. Full
arguments, results and call IDs generally come from history. In particular,
overlapping calls to the same tool cannot always be matched live. Missing details
must look unavailable, not empty-but-successful or permanently loading.

### Delegation

Hermes can report delegated-task start/completion with optional goal, status,
summary and duration. Include these in the same activity/details surface.
Do not design a required live multi-agent graph, every child's internal tool
stream, or a fabricated percentage. Child output fragments are not automatically
evidence for the answer.

### Approvals

- Pending approval is an actionable, visible state near the active turn. It must
  not be buried inside collapsed details or look like an ordinary tool result.
- Show the native description and redacted command clearly. Allow long commands
  to wrap or scroll without clipping; make the full supplied text inspectable.
- Render only the choices Hermes actually offers. Distinguish **Allow once**,
  **Allow for this session**, **Always allow**, and **Deny** when present.
  Broad permissions must never be the ambiguous default action.
- Show submission, accepted/denied, expired and submission-failure states. A
  resolved or finished request is no longer actionable.
- An approval permits an action; it does not certify its result. Do not expose
  credentials or restore portions Hermes deliberately redacted.

## 7. Reading, sources and answer actions

- Render headings, paragraphs, lists, emphasis, links, blockquotes, tables and
  code readably, including incomplete Markdown during streaming.
- Tables retain aligned values, units and headers. On narrow screens, use local
  horizontal scrolling where necessary instead of widening the entire page or
  destroying a useful comparison.
- Follow new output only while the reader is at the bottom. Scrolling upward
  immediately detaches follow-scroll. Offer an explicit Jump to latest control.
- Opening details, sources or answer information must not drag the reader away
  or shift the whole transcript unnecessarily. Preserve position on reload/history
  enrichment where feasible; do not replace a newer turn with an older snapshot.
- Completed answers offer Copy with short confirmation feedback. Keep the compact
  Copy/Sources row visible on older answers too, slightly inset from the text
  edge. Model identity and supplied token totals remain in message metadata;
  the action row does not expose a separate response-information control.
- Preserve source links beside the claims that contain them. A compact Sources
  popover may collect explicit answer links as a convenience, not replace inline
  provenance. Tool calls and search attempts are not themselves citations.
- Show dates, retrieval times, units, freshness and evidence distinctions when
  supplied. Do not fabricate passage citations, source dates, confidence scores,
  verification badges, cost estimates or token values that are absent.

Pythia's broader design principle is to distinguish sourced fact, machine
assessment and human judgment. In this version that requires honest content and
provenance treatment; it does not imply an implemented automatic claim classifier.

## 8. Files and images

Support file selection, multiple files, clipboard images/files and drag-and-drop
into the composer. The browser may be on another device: these are uploads to
the Hermes host, not paths to files on the browser's computer.

Design the complete attachment lifecycle:

| State | Required content/actions |
| --- | --- |
| Selected/uploading | Compact filename card, file identity or thumbnail, upload indicator, Remove |
| Ready | Filename, useful size information, image thumbnail when appropriate, Remove |
| Upload failed | Readable cause, Retry, Remove; retain the rest of the draft |
| Limit exceeded | Explain the applicable limit without losing already accepted attachments |
| Sent | Durable attachment card beside the user's message; file download or image preview |
| Image preview | Larger decoded image, filename, Download, Close; keyboard dismissal and focus restoration |
| Missing/unreadable | Explain the failure without a broken-image-only state or silent click failure |

Current limits: ten files per message; 20 MiB each; 50 MiB combined; 6 MiB combined
for images. Native inline image types are PNG, JPEG, GIF and WebP. Other encodings
remain ordinary files; do not promise a thumbnail or inline vision for them.
Use one filename announcement per card, not duplicated image-alt and label text.

Hermes receives image content natively and uses its tools to read/extract ordinary
documents. Upload success is not a promise that a particular model can interpret
every format. Preserve the native error if interpretation is unsupported. There
is no separate Pythia document-analysis engine or invented universal vision flag.

Attachments persist when reopening a chat. Retry must preserve their references.
Native steering is text-only: additional attachments belong to a subsequent
turn, not the running turn. Removing a draft card excludes it from the message;
it does not delete already uploaded bytes. There is currently no automatic
orphan cleanup. Do not label that action “Delete file permanently.”

Uploaded-file downloads are supported. Automatically publishing arbitrary files
generated by a tool as downloadable answer artifacts is a separate, unqualified
feature; the designer must not assume it already exists.

## 9. Model selection and model management

The everyday selector is a compact button-like control that blends into the
background below the input. It opens a searchable popup. Search belongs at the
top of that popup; users should not have to edit the selected model label.

- Use compact rows: model name on the left, provider on the right. Avoid a
  repeated subtitle beneath every model name.
- Constrain long names without hiding their full identity from inspection.
  Preserve clean top/bottom padding, a fully visible focus treatment, an unclipped
  first row, and a scrollbar contained within the list.
- Keep search visible and the management action in a stable footer. Footer icon
  and text sit on one line. Opening/searching produces a sensible scroll position
  with the selected/relevant item reachable.
- Show the resolved model/provider; an unexplained “Default” is not sufficient.
  Remember browser choices without implying the selection rewrites every Hermes
  session or the user's global configuration.

**Current catalog behavior follows Hermes Desktop:** configured providers are
ordered alphabetically; native model order is preserved. The unfiltered shortlist
uses native featured models, or the first 50 for a provider without a featured
list, and always includes the current model. Search spans the complete configured
native catalog. “Edit visible models” customizes the unfiltered shortlist; it
does not remove models from search. Treat any change to that behavior as a product
decision, not an accidental consequence of the new layout.

The separate management dialog uses provider tabs, model visibility controls and
whole-provider visibility actions. Group configuration/status information there
instead of adding it to every compact row. Distinguish changing the shortlist
from connecting/disconnecting a provider.

Communicate these states separately:

- Provider configured/authenticated according to Hermes.
- Provider not configured; a clear route to the supported setup instructions.
- Native catalog warning or explicitly unavailable model.
- Configured provider whose model failed at runtime.
- Explicit native “Free” metadata, subscription/API authentication information,
  known pricing, and unknown pricing.

Do not infer access, free usage, price or priority from model names. A configured
provider is not a guarantee that every listed model works. Unknown pricing is
not zero cost; subscription authentication is not the same as an unconditional
free model. Show only the authentication information Hermes supplies, never keys
or secret values. Unavailable models may remain visible but disabled with a reason.

“Refresh models” performs an explicit native catalog refresh. Design its loading,
success/no-change and error states without clearing a usable current selection.
It refreshes discovery; it is not a model benchmark or proof of working inference.
Recently used/favorite model grouping may be explored as a future refinement;
it must not replace native availability or silently introduce a curated alias list.

## 10. Reasoning effort selector

Use a separate compact dropdown below the input, matching the model control's
quiet visual weight. No search field is needed for this small set. Inside it,
use the accepted compact layout: ordered effort options and small icon-plus-label
Auto/Off actions, without a divider or extra subtitle. Show the selected state
and familiar select-like pointer, hover, keyboard and focus behavior.

The native ordering is:

**Minimal → Low → Medium → High → Extra high → Max → Ultra**

**Auto** means no explicit effort override: Hermes/model defaults apply. It is
not a promise of adaptive optimization. **Off** corresponds to native `none`;
it is not merely the lowest enabled effort.

Honor Hermes's `reasoning` and `can_disable_reasoning` flags. Do not offer an
active reasoning control for a model explicitly marked as not supporting it,
or Off when disabling is explicitly unsupported. Remove incompatible stale
selections when the model changes, with an understandable resulting label.

The pinned catalog does **not** provide a reliable, exhaustive list of supported
effort levels for every model. Hermes owns mapping/clamping of the canonical
ladder. Do not hardcode per-model aliases or present every displayed level as a
verified distinct capability. Auto remains the least assumptive default.

## 11. Run lifecycle, recovery and errors

Design these states as a coherent sequence, not unrelated banners:

| State | User needs to understand |
| --- | --- |
| Starting/queued | The submission was received; avoid duplicate sends |
| Working | Latest observable activity and elapsed time |
| Awaiting approval | What needs permission and the available choices |
| Streaming answer | Readable output; independent scrolling; Stop remains available |
| Steering submitted/accepted | Guidance is pending or Hermes acknowledged it |
| Stopping | Stop was requested; backend cancellation is not yet confirmed |
| Stopped | Work was interrupted; preserve useful partial output and honest tool states |
| Completed | Stable answer, details, sources and secondary metadata |
| Failed | Concise native cause, useful model/provider/HTTP context, Retry |
| Reconnecting | The connection is interrupted; the backend may still be working |
| Disconnected | Reconnection did not recover; do not claim the run was cancelled |

Errors use the existing compact alert vocabulary. Lead with the useful native
cause; put model/provider and supplied HTTP status in secondary context. Unwrap
serialization/relay noise without replacing the cause with generic prose such
as “Pythia could not finish this reply.” Keep useful multiline formatting.

Retry is explicit, preserves the submitted attachments, and must not silently
switch providers. Do not offer successful-answer “Regenerate” as though Hermes
could replace the existing append-only conversation turn.

Reload/reconnect resumes an existing native run rather than starting another.
Closing the browser or losing the stream does not mean Stop. Native guidance
accepted too late may be returned for the next turn; do not silently drop or
duplicate it. Pending approvals and partial answers must remain understandable
after recovery even when some history metadata is unavailable.

## 12. Hermes scope boundaries

| Capability | First-version design scope |
| --- | --- |
| Sessions/history, streaming, tools, approvals, stop/reconnect | Core chat requirements |
| Model catalog and reasoning controls | Core, with native capability limitations above |
| File/image uploads, previews, downloads | Core; interpretation remains native/model-dependent |
| In-run guidance | Conditional on Hermes advertising steer support; text-only |
| Recorded reasoning and delegated-task metadata | Conditional; render only supplied data |
| Memory, skills, MCP tools and toolsets | Their work appears through normal activity/results; configuration belongs in companion settings |
| Tool/skill enablement and credentials | Separate settings/setup workflows; not a large composer toolbar or browser credential editor |
| MoA / Mixture of Agents | Not offered in discovery; current API cannot establish preset readiness or expose proper MoA progress/configuration |
| Existing saved MoA selection | Preserve the selection without silently rewriting it; no ordinary effort control; user may choose another model |
| Branching, editing old turns, successful-answer regeneration | Outside this version; branching is explicitly deferred |
| Browser-control transport | No browser-control panel, remote browser viewer or takeover flow is qualified by this chat integration |
| Voice, audio transcription, video analysis, generated-file gallery, export/share, dedicated scheduler | Not established by the current chat contract; separate proposals, not assumed requirements |

Hermes browser-control transport is a separate mechanism for browser-related
interaction/artifacts. It is not the attachment-upload transport. An ordinary
browser tool call can still appear in tool activity without a dedicated browser
control UI. Likewise, the existence of a native tool such as memory or scheduling
does not imply that its own management screen belongs inside the chat window.

## 13. Accessibility and responsive acceptance

- Complete keyboard use: composer, both selectors, popup search, list navigation,
  attachment actions, disclosures, approval choices and dialogs.
- Visible, unclipped focus rings; predictable Escape behavior and focus return.
  Focus must not move merely because new tokens arrive.
- Meaningful accessible names and state labels; never rely solely on color,
  animation, spinner icons or checkmarks. Icon-only controls need accessible labels.
- Announce important status changes without reading every token or every elapsed
  second to a screen reader. Respect reduced-motion preferences.
- Readable contrast in light/dark themes, usable touch targets, browser zoom,
  long filenames/model names and long error text.
- No page-wide horizontal overflow. Keep necessary scrolling local to tables,
  code, tool results or popup lists. Support both desktop and phone keyboards.

## 14. Required designer handoff

Provide a connected flow and annotated component states, not only a finished
answer screenshot. At minimum include:

1. Empty chat with focused composer and quiet controls.
2. Short and tall multiline drafts; mixed ready/uploading/failed attachments.
3. Active activity line and its transition into collapsed details as text begins.
4. Streaming answer while the reader is scrolled upward.
5. Completed research answer with a table, inline sources and answer actions.
6. Expanded details with reasoning, tool success/failure/unconfirmed states and delegation.
7. Pending approval with long command and restricted choice variants.
8. Active steering, stopping, stopped, failure/retry and reconnection.
9. Model popup: default, search, long names, unavailable items and catalog failure.
10. Provider-tab management dialog with configuration, pricing and warning variants.
11. Effort dropdown: Auto, explicit level, Off, unsupported reasoning and non-disableable reasoning.
12. Image preview, document download, missing attachment and limit errors.
13. Reopened history, loading older messages, and history-fetch failure.

Cover desktop and narrow phone layouts, light/dark themes, focus/hover/disabled
states, and reduced motion. Annotate scroll ownership, focus destination,
transition triggers, overflow behavior, loading behavior and the information
source for conditional labels. Map proposed designs to existing shared components;
identify any genuinely missing reusable component separately.

## Source of truth

- [Design direction](../design.md): visual language and research trust principles.
- [ADR 0009](../decisions/0009-chat-surface-on-ai-sdk-transport.md): accepted chat interactions and native transport constraints.
- [ADR 0010](../decisions/0010-local-chat-attachments.md): attachment behavior, limits, storage and retention.
- [Hermes contract](../../runtime/contracts/hermes.md): pinned API fields, events, model settings and limitations.
- [Desk README](../../apps/desk/README.md): current product surface and catalog behavior.
- Pinned upstream [run adapter](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server_runs.py), [API server](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server.py), and [inventory](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/inventory.py).

When a concept needs backend data outside these contracts, flag it as a proposal
before presenting it as functioning product behavior. No upstream Hermes changes
are part of this brief.
