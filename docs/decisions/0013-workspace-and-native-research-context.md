# 0013: Workspace and native research context

Status: accepted. Supersedes the default Basic Memory service and split research
storage in ADRs 0002 and 0004. Extends ADRs 0009 and 0010 without replacing their
native conversation, stream, admission or attachment-retention ownership.

## Context

Investors primarily work through conversation, while research should remain
inspectable and useful beyond a chat. Separate working and indexed-research
locations obscure where outputs belong. Automatically loading all past research
or every strategy would consume context and blur distinct goals. Hermes already
owns file tools, memory, sessions, skills and context compaction; adding another
agent or knowledge engine would duplicate those owners.

## Decision

One investor-owned workspace contains ordinary Markdown, datasets, scripts,
spreadsheets, images, PDFs and other artifacts. No investment-case schema,
registration database or mandatory folder taxonomy is required. The agent
chooses useful durable outputs and links to the files it actually saved. Not
every answer needs an artifact. Chat upload originals remain at the existing
attachment integration paths; copying useful sources into research never removes
or moves those originals.

Hermes remains exact and unmodified. Its native layers have distinct purposes:

| Layer | Purpose and context use |
| --- | --- |
| Native memory | Concise, stable investor preferences and global facts useful across chats, delivered through Hermes's bounded memory snapshots. |
| Workspace files | Working material, durable research and detailed strategy context, found with native file/search/terminal tools and read when relevant. No automatic workspace map or document preload. |
| Native sessions | Conversations and historical reasoning, recalled selectively with native session search. Earlier discussion is evidence of prior reasoning, not current truth. |
| Native skills | Reusable procedures selected when useful, not an investor-fact store. |

The existing `pythia.operating` plugin section explains these layers and their
boundaries. The managed `investment-memory` skill owns substantive source,
date, unit, evidence and revision habits and depends on native file tools.
User-owned SOUL, profile and workspace seeds remain create-once. Contributor
`AGENTS.md` and `.agents/` remain excluded from automatic runtime inputs.

Strategies are optional reasoning scopes over shared research. A brief at
`strategies/<name>/README.md` supplies goals, risk settings, assumptions and
decisions, with an optional Markdown heading for its label. General chats and
files require no strategy. A strategy is distinct from an investment account,
and a hypothetical comparison is distinct from an adopted mandate or capital
authorization. Global preferences stay global; scoped conclusions stay scoped.
Current user directions take priority over prior preferences and strategy
defaults. Reading another page does not switch the conversation's scope.

Starting a scoped chat explicitly references its brief in native user input.
The unique opening scope note records its originating native session and brief
path. Subsequent turns carry bounded provenance separately for continuity, not
a stronger mandate or another searchable opening note. Desk labels the association as the strategy the conversation started
with. Missing or moved briefs remain unresolved. Strategy association is not a
second session store, process-global cwd change or separate Hermes profile.

Ordinary native HTTP history excludes compaction-archived messages. A narrow
server-selected, read-only helper uses the pinned native SessionDB methods to
recover exact scope notes and report current/legacy/unavailable managed-guidance
status. It validates active or compacted anchor eligibility and compression
lineage, excludes rewound notes and refuses ambiguous or incomplete lookup.
It returns no raw transcript or system prompt. No SQL schema, index or archived
history viewer is reimplemented. The small pinned private checks required for
index availability and native prompt-section framing are qualified with the
exact runtime and must be revisited on a pin change.

## Desk file boundary

Desk provides both a standalone Workspace and a companion viewer beside chat.
Opening an artifact preserves the primary conversation and its retained SDK Chat
instance; it never adds a second native event-stream consumer. References can be
inserted into the intended draft without sending it. Server validation composes
bounded file context into native input; whole documents are read with native
tools as needed. Canonical host references remain valid if terminal cwd changes.

The first version is read-only in Desk: browse, fuzzy filename/folder-name search,
read, download and reference. Desk content search is deferred. Markdown supports ordinary links,
headings, tables and code; images, PDFs and text/code have suitable viewers.
Other formats remain downloadable. PDF text search, OCR, spreadsheet engines,
math/Mermaid, wiki links, backlinks, direct editing, file-management controls,
diffs, history and undo are deferred. Native agent tools and external editors
can still write files. Readers automatically show the latest available content
and indicate updates, preserving reading position where practical. They report
unavailable content without claiming which writer caused a change.

The admitted host API is rooted at canonical `PYTHIA_WORKSPACE`. It bounds file
reads, traversal, search and preview work, reports partial results and avoids
symlink escapes or nonregular files. Reserved attachments and internal dependency
or cache directories are excluded from exploration. HTML and SVG are downloads,
not executable same-origin previews; Markdown raw HTML and unsafe schemes are
blocked, and remote images do not load automatically. Relative document links
resolve from their parent; chat file links resolve from the workspace root.

Configured Tailscale access uses the same admitted host APIs and server-owned
files. It does not expose the remote browser's local filesystem. Market-data
owns investment identities and provider operations; file browsing and editing by
native tools are independent. Future company/instrument associations consume
that owner's references rather than introducing ticker matching here.

## Current Desk view

The existing Pythia plugin adds `pythia_desk_view(view_reference)`, a bounded
structured description of the submitting Desk tab's recent route/title and
observable file context. It applies beyond Workspace; it is not browser control,
a screenshot, a DOM dump or a document reader. Settings values are not captured.
A server-minted reference binds admitted browser/tab ownership and native session.
The transient private cache lives outside research, is written only by Desk,
and expires after 60 seconds without foreground publication. Wrong-session,
expired, missing, restarted or unsafe state returns unavailable; there is no
global last-tab fallback. Provider subprocesses receive no view-state access.
Native toolset settings remain authoritative, including when the tool is disabled.

## Basic Memory retirement and instruction adoption

Fresh stacks no longer require Basic Memory's package, MCP configuration,
service, readiness or split knowledge directory. Existing installations require
an explicit staged transition owned by the lifecycle transaction, not automatic
startup migration. Preflight runs before dependency synchronization or service
replacement can remove the old usable executable. Customized or unresolved state
blocks activation while ordinary Workspace file access remains independent.

The transition preserves original notes and configuration, copies the legacy
layout into a collision-free workspace import and verifies bytes. Unsupported
legacy links are reported rather than rewritten. Only an identified Pythia-owned
MCP entry is disabled through native commands. User-owned instruction changes
require a concrete reviewed diff; unrelated configuration, units and drop-ins
remain untouched. See the [transition procedure](../update-and-customization.md#workspace-transition)
for the staged commands and recovery boundary.

`[PYTHIA_WORKSPACE_GUIDANCE_V1]` identifies the managed operating section. Native
ordinary resume restores stored prompt bytes; restarting or copying new source
does not retroactively update those instructions. Native compaction invalidation
can re-render sections, but a fresh session is the reliable adoption boundary.
Legacy chats remain readable and resumable with an honest notice. “Continue in a
new chat” carries a prior-session reference for selective native recall instead
of copying the transcript or rewriting native history. An exact native snapshot showing no retained message rows and eligible session metadata
can admit the first scoped input before a prompt exists. That snapshot does not
label guidance current: guidance remains unavailable until the managed section
is observed. Subsequent scoped use requires current guidance; missing evidence
is not treated as successful adoption. Retirement requires the staged preservation/instruction checkpoint.

## Consequences and rejected alternatives

Ordinary files remain useful outside Pythia and require little investor upkeep.
The first reader intentionally leaves advanced research management for later.
File changes and prompt freshness are observable limits, not promises of agent
judgment or an editing conflict-resolution engine. Structural native probes do
not prove model behavior, browser ergonomics, Ubuntu activation or remote access;
those require their own evidence.

Rejected alternatives include another agent loop, knowledge service or index;
all-document/all-strategy prompt injection; rigid investment cases; a profile
per strategy; a strategy-account registry; a shadow conversation database;
mandatory strategy onboarding; automatic attachment promotion/deletion; and
silently migrating investor instructions or pretending cached chats refreshed.

## Search result refinement

The first mixed search list repeated filenames in paths, hid match locations and
allowed incidental content hits to crowd out exact file names. Later profiling
showed that a global scan opened about 15,200 files and performed hundreds of
thousands of metadata operations for each query. Removing the scan timeout made
coverage complete but left long waits. The user prioritized performance and
accepted a simpler v1 with fuzzy name search; reliable content search is a
separate future decision.

V1 now searches filenames and folder names only. It reads directory entries and
validates retained result metadata without opening file bodies. Large files,
PDFs, images and datasets remain equally searchable by name. All/Names/Contents
controls, content excerpts and the content-read worker are removed from search.
File previews and native Hermes file tools retain their existing capabilities.

Search defaults to the whole workspace. A Finder-style Search location control
appears with results and lets the user narrow to the current folder and its
descendants. Changing scope preserves the query, explorer location and reader
tabs. Navigating the explorer resets the query and the global scope default.

Exact names/stems rank above prefixes, other literal name matches, typo matches
and combined folder/file queries. The initial ordered-character matcher returned
unrelated names such as `fictional-research-example` for `scale`, while rejecting
the intuitive adjacent typo `scael`. It is replaced with a bounded
Damerau–Levenshtein comparison: at most one edit per alphabetic query word of
five or more characters, against a complete filename word. Swaps, insertions,
deletions and replacements count as one edit. Short words and numeric/alphanumeric
tokens have no typo correction; quoted phrases remain literal. Unquoted query
words split on spaces, hyphens and underscores. Matching is case-insensitive and
punctuation is never regex. An ancestor-only match does not return every
descendant: at least one term must match the item's own name.
Results show a filename, parent location and highlighted matching characters.
Typo matches highlight the corrected word, without an underline.
The parent location is plain context text. Only the item name opens a result;
the secondary line does not introduce a separate navigation action.

There is no time cutoff, format exclusion notice, content extraction, index or
new dependency. Cancellation and bounded traversal/results protect resources;
actual incomplete results remain visible. The retained limits are documented in
the [Desk contract](../../apps/desk/README.md). File size no longer drives search
work; file count and directory depth still matter and require larger measurements.
The implementation compiles a query once and computes highlight arrays only for
retained results. Short-lived client result caching does not become durable state.

An optimized content scan could improve today's dataset but would still reread
files on new queries. Persistent indexes and format extractors bring freshness,
rebuild and lifecycle ownership beyond this v1. They are deferred, as are semantic
retrieval and corrections beyond one edit. Merely raising
limits or putting a deadline back would not satisfy the performance requirement.
Future content search must be measured with large documents, cold reads, updates
and concurrent workloads before becoming part of the default experience.

The one-edit comparison stays in the existing streaming matcher. At this bound,
checking the first mismatch and the remaining suffix is linear in word length
and needs no edit-distance matrix. uFuzzy 1.0.19's SingleError mode was evaluated
as a library alternative, but its public filter API prepares a query for a whole
list. Adopting it here would require batching the scan or repeated compilation.
The small bounded comparison preserves the current traversal and introduces no
dependency, index or service. See the [uFuzzy API](https://github.com/leeoniya/uFuzzy)
and [Meilisearch typo rules](https://www.meilisearch.com/docs/resources/internals/typo_tolerance)
for the research behind this choice. Arbitrary abbreviations are intentionally
removed in favor of predictable typo tolerance.
