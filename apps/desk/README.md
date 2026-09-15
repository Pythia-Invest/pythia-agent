# Pythia Desk

Pythia Desk is the local browser interface for Pythia Agent. It runs on
loopback beside the pinned, unmodified Hermes runtime. Hermes remains the
authority for conversations and execution; Desk keeps the Hermes bearer on the
server and translates only the qualified session and run APIs.

From the repository root:

```sh
just dev-init
just dev
```

The foreground command prints this worktree's Desk URL. `Ctrl-C` stops Desk,
and Hermes together. Development state and ports are isolated per
worktree.

Desk is being rebuilt from the [design direction](../../docs/design.md).
The current shell is the left navigation: the Pythia wordmark, app
destinations starting with **New chat**, pinned chats, and recent chats
sorted newest first from the native Hermes session list. Pins are a
browser-local preference kept in `localStorage`; Hermes has no pin concept and
Desk does not add a session store for it.

Chats have their own routes (`/c/<session id>`); the root is the new-chat
surface whose first prompt creates the Hermes session. Server state is read
through TanStack Query hooks in `src/client/queries.ts`. The conversation
itself runs on the AI SDK's `useChat` with a Hermes `ChatTransport`
(`src/client/hermes-transport.ts` and `hermes-run-mapper.ts`): streamed text,
recorded reasoning, tool activity,
approvals, in-run guidance, reconnection, model selection, and stop all flow
through that one seam, so a different harness
only needs a different transport.
One SDK chat instance survives route and dock changes for each visited session.
Native status recovers final output and approvals if Hermes's consuming event
queue disappears; Stop keeps observing until Hermes confirms the run ended. See
[ADR 0008](../../docs/decisions/0008-desk-client-conventions.md) and
[ADR 0009](../../docs/decisions/0009-chat-surface-on-ai-sdk-transport.md).

The composer keeps model choice quiet and follows Hermes Desktop's catalog
rules. The compact picker orders configured providers alphabetically, labels
each row with its provider, and preserves Hermes's curated model order. It opens with Hermes's featured models,
or the first 50 models for a provider without a featured list, and always keeps
the current model visible. Typing searches the complete native catalog without
reordering it. **Edit visible models** uses provider tabs to change the unfiltered shortlist; native
warnings, availability and pricing remain Hermes-owned. Desk does not infer
priority, price or opt-in status from model names.
**Refresh models** explicitly invokes Hermes's native forced refresh, which
busts its provider model cache and probes configured custom providers; ordinary
picker loads continue to use Hermes's cached path.
The pinned API cannot distinguish Hermes's implicit Mixture-of-Agents example
from a deliberately configured, runnable preset and does not stream native MoA
progress. Desk therefore does not offer MoA in the picker. A previously stored
MoA selection remains a pass-through session value until the user chooses
another model, without the ordinary reasoning-effort control or a stale saved
effort override.
Desk does not validate providers independently or turn those preferences into
runtime configuration. Native run failures appear in a compact inline block
that unwraps serialization and relay prefixes from Hermes's message, identifies
the selected provider/model and HTTP status when available, and offers Retry.
Desk does not classify the cause or replace it with its own guidance.

The conversation loads the latest native history first and can prepend older
pages without moving the reader. Completed answers offer copy controls, retain
explicit source links. Native token usage remains in message metadata.

Files and images can be selected with the paperclip, pasted or dropped into the
composer. Uploads show compact cards with removal and retry; sent images open a
preview and attachments can be downloaded again after reopening a chat. Files
are uploaded to the Hermes host even when the browser is on another device.
Desk supports ten files per message, 20 MiB per file, 50 MiB combined, and a
6 MiB combined image budget. PNG, JPEG, GIF and WebP use native image content;
other files are read with Hermes tools. Interpretation depends on the selected
model and available native tools. Attachments are sent in new turns, not steering.

Local originals live under `PYTHIA_WORKSPACE/attachments`. Removing a draft
card removes it from the message, but retains uploaded bytes. There is no
automatic cleanup in this version. See [ADR 0010](../../docs/decisions/0010-local-chat-attachments.md)
for storage, admission, retention and native message details.

Run focused checks with:

```sh
pnpm --filter @pythia/desk check
pnpm --filter @pythia/desk test:unit
pnpm --filter @pythia/desk build
```

Browser smoke tests in `e2e/` run against a Desk that is already running.
Install the browser once (the workspace disables install scripts), then point
`PYTHIA_DESK_URL` at the Desk origin printed by `just dev-paths`:

```sh
pnpm --filter @pythia/desk exec playwright install chromium
PYTHIA_DESK_URL=http://127.0.0.1:<desk-port> pnpm --filter @pythia/desk test:e2e
```

The suite never starts or reconfigures the stack; tests that need a chat skip
when the profile has none.

The browser never calls Hermes directly. Every privileged Desk route first
checks the loopback Host (or explicitly configured Tailscale access)
and requires same-origin request metadata or the
browser-session token. Mutations always require JSON and the CSRF token. Model authentication uses the
native repository command shown by the onboarding state; Desk does not read or
store OAuth or API-key credentials. For
shared development authentication and model defaults, see
[development](../../docs/development.md).

For optional HTTPS access through native Tailscale Serve, see
[development](../../docs/development.md#optional-tailscale-access) and
[hosting](../../docs/hosting.md). Host and account are operator configuration,
not repository defaults. Tailscale is never required for local access.

Device settings keep the two native Hermes controls separate: skills change
the profile's global `skills.disabled` list, while Desk tools change only the
`api_server` platform. Desk runs the pinned Hermes command under one external
mutation lock, asks the lifecycle owner to restart Hermes, and reports success
only after the authenticated native API shows the requested state. It does not
infer mismatches or modify another platform.

The SEC identity and EODHD token are optional. Desk writes them atomically to
the permission-restricted Pythia settings and secrets files and returns only a
readiness status. Stored values, the Hermes bearer, and OAuth credentials are
never returned to browser code or placed in command arguments.

## Workspace

`/workspace/[[...path]]` is the independent research explorer and reader; artifact
links from chat open a companion viewer while retaining the conversation. Desk
uses admitted `/api/workspace/` routes rooted at `PYTHIA_WORKSPACE`, with bounded
ranked fuzzy filename and folder-name search. Markdown, raster images, PDF and
text/code have viewers; other files can be downloaded. Direct editing and file
management, OCR/PDF text search, spreadsheet rendering, backlinks and version
history are deferred. Native agent/external writes remain possible and the
reader automatically shows the latest contents with an update notice, preserving
reading position where practical and without attributing a writer.

Use **Reference in chat**, or **Cmd+Shift+Enter** on macOS /
**Ctrl+Shift+Enter** elsewhere while focus is in the file reader. The shortcut
does not intercept editable fields. An active chat receives the reference in its
draft; standalone viewing offers a target conversation or new chat. Nothing is
sent automatically and existing draft text is preserved.

References are bounded structured data composed into native user input after
server path validation. Their canonical host path remains useful after a native
terminal cwd change. Ordinary Markdown links resolve relative to the document;
chat workspace links resolve from the root. HTML/SVG are downloads, raw Markdown
HTML and unsafe URL schemes are blocked, and remote images require an explicit
external action. Attachment originals stay in the existing reserved integration
folder and are excluded from ordinary workspace exploration.

Chat presents workspace files as compact controls with a file icon and filename;
ordinary web links remain underlined. Tables in the file reader expand to their
full height, with horizontal scrolling when wider than the available space.
The companion uses file tabs for names and closing files, above one compact
path toolbar with reference and download actions. Closing the last tab closes
the panel; there is no separate toolbar X. Phone drawers still dismiss with
Escape, backdrop or swipe. File-viewer folder paths open their contents menu only on click; hovering
never opens a menu. Nested folders open adjacent panes on click or keyboard
ArrowRight. File selection opens that file; browsing or dismissing menus preserves
the current document.
Only open popup levels request bounded directory listings; there is no tree crawl.
Standalone Workspace currently uses a single folder browser without a left
sidebar. The main pane opens folders/files on a single click (or Enter). Folders navigate in place; files open the exact same resizable
companion viewer used by chat (a modal drawer on phones), while their containing
folder remains visible in the main pane. Browsing other folders, Home, Up and
Back/Forward never close the viewer. Opening files and switching file tabs do
not navigate the folder browser. Direct file URLs also open that viewer.
File tabs retain their reading position when switching and discard that saved
position when closed. Explicit document-heading links take precedence over a
saved position for another heading. Only the active reader publishes Desk context.
Full paths identify tabs in tooltips and overflow entries, and shared file-type
icons identify artifacts throughout the browser, menus and viewer.
Open files use the chat tab strip and its capped sizing, overflow, keyboard
navigation and adjacent-tab close behavior. A path opens once; selecting it
again activates its existing tab. Closing a file selects its neighbor, while
dismissing the phone drawer retains its open tabs for the next file opening.
The Name/Type/Size listing shares file icons with search results. Sidebar pins
and width preferences from the earlier layout are retained but unused by this
variant.
The shared shell header always retains its window title, main search field and
Cmd/Ctrl+K shortcut. Workspace never replaces or customizes that layout header.
A separate toolbar inside the Workspace page, beneath the shell header, owns
Back/Forward, Up, Workspace home, the current folder path and a folder-scoped
search field.
Up uses the displayed folder, including when arriving via a direct file URL.
Explorer breadcrumbs navigate directly to that folder in the main pane; they
never open menus or change the file viewer. Contents popups belong only to the
file-viewer breadcrumbs.
Workspace search defaults to the whole workspace, even while browsing a nested
folder. Once a query is entered, a compact Search location control offers
Workspace and the current folder (including its descendants). Switching scope
preserves the query, explorer location and open reader tabs. Explorer navigation
clears the query and restores the global default.
Search results show each filename once, its parent folder, and highlighted
matching characters. Parent locations are plain context text; clicking the item
name opens the file viewer or the matching folder. Opening a file preserves the
query. V1 searches filenames and
folder names only; file size and format do not affect search coverage. The
All/Names/Contents controls and content excerpts are deferred with content search.

Matching is case-insensitive. Exact filenames/stems rank first, then prefixes,
other literal matches, typo matches and combined folder/file matches. Unquoted
query words split on spaces, hyphens and underscores. Alphabetic words of five
or more characters allow one insertion, deletion, replacement or adjacent swap
against a complete filename word. Short words, numeric/alphanumeric tokens and
quoted phrases remain literal. For example, `scael` finds `scale-exact-target.md`;
`scale` does not find `fictional-research-example` through scattered letters.
Punctuation is never regex. Each term must match the filename or a containing
folder, with at least one term in the item's own name. A folder query returns
that folder rather than every descendant solely because its ancestor matched.
Typo matches highlight the corrected word; literal matches highlight the matched
characters. Highlighting has no underline.

Folder listings and search results validate metadata without opening file bodies;
preview classification happens when the reader requests an entry. Search walks
checked directory entries, independently of the browser's 1,000-entry listing cap.
It inspects at most 50,000 entries, retains only name matches for ranking, and
validates up to 100 ranked results. There is no search time limit. Cancellation,
entry and result bounds remain; actual incomplete scans or read failures are
reported. The query is compiled once, scoring avoids allocating highlight arrays
for every file, and highlight ranges are produced only for retained results.
Search cache entries expire 30 seconds after becoming unused; changing query or
scope cancels the active request and browser focus does not rescan it.

No search index, content parser, provider operation or Hermes change is added.
Native agent tools remain available for content research; Desk file previews are
unchanged. Complete content search needs a separately measured design.

The standalone file toolbar retains reference/download actions; the companion
retains its own compact path toolbar and folder menus.
Icons use restrained copper for folders, blue for documents/images/PDFs, green
for data/code, and neutral gray for other files. Shapes and filenames identify
types independently of color. Dedicated artifact tokens adapt to light/dark;
they do not use investment-signal or status roles.
Recently visited metadata and listings are reused for five seconds while periodic
freshness checks continue; approaching a file row prefetches only its metadata.
The browser requests bounded listings for the current folder. Native history
integration preserves the layout while updating the selected URL.
Strategy briefs retain their scoped-chat action; folder browsing has no strategy
onboarding block.
Chat also accepts `file:///...` links to files on the Hermes host. Clicking one
resolves it through the same admitted workspace boundary before opening the
reader; it never opens the browser device's filesystem. Paths outside Workspace
and file URLs naming remote hosts are unavailable.

Click the conversation header title to rename a chat. Enter or leaving the field
saves through Hermes; Escape cancels. A failed save retains the draft for retry.

Optional briefs at `strategies/<name>/README.md` support explicitly scoped chats
over shared research. General chats and files remain available without them.
Scope is recovered from native conversation provenance, including eligible
compacted notes, through the bounded native read-only helper; no browser-local
scope store or strategy database owns it. Missing evidence stays unresolved.
Legacy instruction notices distinguish ordinary resume from a fresh continuation.

The shell can publish recent structured route/title and observable file context
to a transient cache. `pythia_desk_view` reads only the reference bound to the
submitting tab/native session, with a 60-second expiry; it cannot control the
browser or inspect arbitrary page fields. Configured Tailscale uses these same
admitted host APIs. See [ADR 0013](../../docs/decisions/0013-workspace-and-native-research-context.md)
for accepted scope and the separate browser/remote qualification boundary.

Settings reports the Desk workspace root and native `terminal.cwd` as matched,
different or unavailable. A differing native cwd is preserved, not reset;
browser file access remains rooted at the configured Desk workspace. Canonical
absolute file references continue to identify those files for native tools.

### Persisted layout

Use `createLocalLayout` from `src/layout/local-layout.ts` for browser-local panel
visibility and bounded sizes. Register its `definition` in the root layout's
`layoutBootstrapScript` call, and consume the store with `useLocalLayout`.
Render stable markup and use the declared root attributes/CSS properties in
Tailwind selectors so preferences apply before application JavaScript loads.
For native resizable panels, use `useRestoredPanel` to hand initial CSS geometry
to the panel handle, keep `defaultSize` constant, and persist only user-initiated
`onLayoutChanged` completions. See [ADR 0014](../../docs/decisions/0014-browser-local-layout-restoration.md)
and the shell consumers for the complete pattern. This utility is for layout,
not a general store for application data.

Workspace's initial page also seeds TanStack Query on the server with the current
entry and folder listing (`src/server/workspace/initial.ts`). This is a dynamic,
request-local read guarded by page admission, including configured Tailscale
identity. Browser queries retain responsibility for navigation, refresh and error
recovery. `e2e/workspace-initial.spec.ts` performs a read-only check of the
configured host workspace with API calls blocked; other synthetic workspace
tests deliberately exercise the unseeded fallback and never preload host files.

### Artifact previews

The shared reader supports highlighted source/configuration files, CSV/TSV,
Excel and OpenDocument tables, DOCX, saved Jupyter notebooks, PDFs, raster images
and common native audio/video. See [ADR 0015](../../docs/decisions/0015-workspace-artifact-previews.md)
for exact formats, limits and fidelity boundaries. Office/notebook previews are
passive: formulas, macros, kernels and embedded scripts are not executed.

The host detects preview kinds in `src/server/workspace/files.ts`. Small shared
presentation definitions live in `src/workspace/previews/formats.ts`, bounded
parsers in `src/workspace/previews/`, and lazy components in
`src/components/workspace/previews/`. `workspace-preview-query.ts` owns the
revision-pinned fetch and worker lifecycle. Code blocks share one Shiki adapter, including in chat and Markdown. Its
16-entry / 200,000-character token cache uses full-source keys; in-flight highlighting is bounded
and files larger than the highlighting budget remain readable as plain text. Do not add another
editor or repeat the reader toolbar inside a format adapter.
