# 0008: Desk client conventions

## Context

The first Desk implementation kept every screen behind one page, selected the
open chat through a `?session=` query parameter, fetched server state with
hand-written effects, and had no browser-level test. Rebuilding the shell from
the design direction was the moment to settle how Desk routes, fetches, and
proves its behavior, before the conversation surface and further sections are
added on top.

## Ruling

- Routes are App Router segments. A chat lives at `/c/[sessionId]`; the root
  is the new-chat surface. The shell (`(shell)/layout.tsx`) renders the
  navigation once and the routed page renders the surface. Sidebar chat rows
  are links to those routes, so the browser owns history, deep links, and
  middle-click.
- Server state is read through TanStack Query. `src/client/queries.ts` owns
  the query keys and hooks; `src/client/providers.tsx` owns the `QueryClient`
  policy (no retries on client errors, one retry on server errors, a short
  stale window, no refetch on focus) and exposes the `DeskApi` through
  context. Components do not call `fetch` or the API class directly, and no
  duplicate store mirrors what Hermes already holds.
- Browser behavior is proven by Playwright smoke tests in `apps/desk/e2e/`.
  They run against an already running Desk named by `PYTHIA_DESK_URL`, on a
  desktop and a phone project, and never start, stop, or reconfigure the
  development stack. Tests that need a chat skip with a reason when the
  profile holds none; they do not create sessions.
- Utility class order is enforced by Biome's `useSortedClasses` on
  `className` and on `cn`, `cnState`, `cva`, and `clsx` calls, so diffs show
  intent rather than reordering. Editor defaults (`.editorconfig`,
  `.vscode/settings.json`, `.vscode/extensions.json`) point every editor at
  Biome, the Tailwind language service, and the three Tailwind entry
  stylesheets.

## Rationale

Real routes give each surface a URL and let the shell be a layout instead of a
state machine. TanStack Query removes the loading, error, and cache bookkeeping
from components and gives one place to tune request policy against the Desk
API. Playwright against the running stack exercises the same Hermes-backed
Desk a person uses, which unit tests with mocked responses cannot, while
keeping the suite free of process management and credentials. Sorted classes
and shared editor settings remove formatting churn from review.

## Consequences

`apps/desk` depends on `@tanstack/react-query` and, for development, on
`@playwright/test`; the Chromium browser is installed explicitly because the
workspace disables install scripts. The smoke suite is not part of `just test`
because it needs a running Desk; run it with `just test-e2e <desk url>` or the
package script. `useSortedClasses` is a Biome nursery rule and may change
ordering between Biome releases; the safe fix handles that mechanically.

## Rejected alternatives

Query-parameter selection on one page (no deep links, no layout/page split,
history managed by hand); `useEffect` fetching with local state (repeats
loading and error handling per component and re-fetches on every mount); a
Playwright `webServer` that starts Desk and Hermes (would need the pinned
runtime, isolated state, and credentials inside the test runner, duplicating
the lifecycle owner); component screenshot tests (brittle to token and font
changes and blind to routing).

## Workspace initial render (2026-09)

Workspace's first folder is read on the server for each admitted page request.
A request-local TanStack Query client seeds the current entry and its folder
listing; `HydrationBoundary` supplies that snapshot to the existing Desk cache.
This removes the browser JavaScript → entry API → listing API waterfall without
introducing another client store, directory index, or persisted server cache.
Native history navigation continues to update the mounted browser, and normal
query freshness, polling and error recovery remain client-owned. Direct file
URLs seed the parent listing; preview content still uses the admitted API.

Because HTML and RSC responses now carry private file metadata, the initial read
uses the same host, origin and configured Serve identity validation as APIs.
Page admission additionally accepts an explicit top-level browser navigation
(`GET`, `navigate`, `document`, `sec-fetch-site: none`) for typed/bookmarked URLs.
Same-origin RSC requests are accepted; untrusted requests receive no snapshot
and never touch workspace storage. API admission is unchanged. Reading request
headers makes the page dynamic; no cross-request/private-data cache is added.
Missing or unreadable entries fall back to existing client error handling;
internal errors and host paths are never serialized into the snapshot.

A production build would reduce development compilation overhead but is not
required for this behavior. Artificial delays or persisted browser copies of
folder contents were rejected: they either mask the wait or introduce stale
research metadata. Browser qualification delays application scripts and blocks
APIs to prove the listing exists in initial HTML on desktop and mobile.
