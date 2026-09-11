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
Hermes, and Basic Memory together. Development state and ports are isolated per
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
