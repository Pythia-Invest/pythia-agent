# ADR 0010: Local chat attachments over native Hermes input

Status: Accepted

## Context

Desk needs files selected on the browser's device to work in a chat running on
the Hermes host, including browsers connected through Tailscale. The pinned
Hermes run API accepts structured user content but has no general durable file
upload endpoint for this workflow. The separate dashboard upload and browser
control artifact transports serve other frontends and lifecycles.

## Decision

Desk owns upload, preview and download presentation. Store original bytes and
a small receipt in `PYTHIA_WORKSPACE/attachments/<random-id>/`, using private
directory/file modes. Both development and installed Desk receive that workspace
from their lifecycle owner. The original filename is display metadata; the disk
basename is `file` with a safe extension. In particular, uploading an `AGENTS.md`
does not create an automatically discovered instruction file.

Browser mutations carry JSON under the existing origin/CSRF admission boundary.
Upload bodies are bounded while reading, including without Content-Length.
Run requests carry opaque receipt IDs, never browser-supplied host paths or
remote URLs. Desk resolves the bytes and paths itself and rejects symlinked
attachment directories/files. Downloads use the same read admission, disable
sniffing and caching, and force download for documents. Only signature-recognized
PNG, JPEG, GIF and WebP bytes may be displayed inline.

For attachments, send native `/v1/runs` input as a user message with content
blocks. The text block contains the user's prompt and a delimited JSON file
note identifying the originals and their local paths. Images additionally use
native `image_url` data-URL blocks. Hermes's own tools read/extract documents;
the native provider adapter handles image support. No Desk extractor, vision
capability registry, browser-control dependency or upstream patch is introduced.

Hermes persists that user content in its session database. Desk reconstructs
standard AI SDK file parts from the note when rendering history, showing the
user's text and attachment cards. The file receipt is storage metadata, not a
second conversation store. New-chat handoff retains receipt IDs in the same
short-lived browser session storage as its pending prompt.

Allow up to ten files per message, 20 MiB per file and 50 MiB combined. Images
share a 6 MiB budget, so their base64 expansion plus the bounded prompt and
metadata fit Hermes's native 10,000,000-byte API request ceiling. Unsupported
image encodings remain ordinary files. Upload success means the file is locally
available; it does not promise that every selected model or installed tool can
interpret every format. Native run errors keep the existing faithful error UI.

## Consequences

The composer supports selection, paste and drop, per-file upload failure/retry,
removal from the draft and attachment-only messages. It waits for uploads before
sending. Sent files remain downloadable, with a larger image preview dialog.
Attachments cannot be added to native text-only steering; they wait for the
next turn.

Uploaded originals remain in the workspace across restarts. Removing a draft
card does not delete its uploaded bytes; neither chat deletion nor an age-based
cleanup may silently remove potentially referenced files. This version has no
automatic orphan cleanup. Operators should include the attachment directory in
workspace backups and account for its disk usage. Moving a workspace preserves
Desk downloads if IDs and files move together, but paths in old Hermes messages
remain host-specific; transcript rewriting is outside this decision.

Rejected alternatives: the dashboard's separate PTY upload flow, temporary
browser-control artifacts, exposing arbitrary paths to browsers, remote file
hosting, and a Pythia-specific document-analysis agent. These either introduce
unneeded services, weaken file boundaries, or duplicate Hermes behavior.

## Evidence

Pinned Hermes `29112bef099274229cadff79cdff7bf7b99c4b77`:
`gateway/platforms/api_server_runs.py` forwards the final input message's
content into `run_conversation`; `hermes_state.py` preserves structured content
in SessionDB; `gateway/platforms/api_server.py` projects it into history.
`gateway/run.py::_build_document_context_note` gives ordinary document paths to
native tools. The upload, native-input mapping and browser workflows are
qualified without provider calls. Actual document interpretation and vision
quality remain model/runtime-dependent.
