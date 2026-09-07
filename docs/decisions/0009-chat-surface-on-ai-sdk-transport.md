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

- The browser conversation model is the AI SDK `UIMessage`. `useChat` from
  `@ai-sdk/react` owns the live message list, status, stop, and stream
  reconciliation. History comes from Hermes through the existing TanStack
  Query layer and seeds `useChat`.
- All Hermes knowledge in the browser lives in `src/client/hermes-transport.ts`,
  a `ChatTransport` that starts a run on Desk's own routes and maps the run's
  events to `UIMessageChunk`s, plus `src/client/chat-message.ts`, which folds
  the Hermes transcript into `UIMessage`s. Swapping the harness means a new
  transport and history mapper; components do not change.
- Hermes-specific concepts that the SDK does not model natively are custom
  data parts: `data-approval` for run-level approvals with Hermes's four
  choices, and `data-run-status` for failure, cancellation, and disconnect.
  Failures render inline as parts rather than erroring the stream.
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
about 175 kB gzipped. Regenerate is hidden
because Hermes sessions are append-only. Approvals bypass the SDK's boolean
approval helpers. Browser smoke tests never send a prompt, since that would
run a real model; they cover history, the empty state, and composer gating.

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
