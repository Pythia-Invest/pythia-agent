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

## Phone layout (2026-09)

Below 900px each desktop component keeps its identity, controls and place in
the hierarchy; only its presentation adapts. Components are not merged,
dropped or folded into one another.

| Desktop | Phone |
| --- | --- |
| Navigation rail | The same rail, alone, in a modal drawer from the start edge, opened by a menu button at the start of the top bar; its collapse control becomes Close. |
| Top bar: title, search, actions | Kept. Search is an icon that expands the same field across the bar, with Cancel. |
| Chat list, collapsible beside the conversation | Kept collapsible, opened over the conversation below the top bar by the chat header's Show chats and closed by its own Hide chats; a top-bar search opens it to show matches, and cancelling closes it again. While open it is a modal layer: focus moves into it, Escape closes it and returns focus, and the conversation beneath is inert. |
| Chat header: Show chats, New chat, title | Shown; its list controls are always present because the list is never beside the column. |
| Chat dock beside a destination, with its edge rail when closed | The dock opens as a full-screen sheet; the edge rail becomes a floating button in the corner so the page keeps its width. |
| Tab strip of open chats or files (dock, file viewer) | No strip. The header names the current chat or file, as a mobile app bar does. In the dock, New chat and the history bottom sheet sit beside it; switching chats goes through history, and New chat returns to an unsent draft rather than stacking one out of reach. A file is closed and another opened from the file list. The desktop tablist keeps arrow-key selection. |
| Chat history dropdown | The same list in a bottom sheet with touch-sized rows and visible pin buttons; the keyboard opens only when search is tapped. |
| File viewer beside a chat | A full-screen sheet with its own close button, since no page shows beside it. |
| Workspace toolbar | Wraps by the width of its pane (a container query), not the window, so it never truncates beside an open dock. |

Leaving the phone layout closes every phone layer. Phone sheets that replace
a side panel fill the screen: a strip of the page
left beside them cannot be used and only narrows the chat. Merging the rail
and chat list into one drawer, folding the chat header into the top bar,
squeezing the desktop tab strip onto a phone, a switcher sheet behind the
header for moving between open chats (a second sheet beside history), a
scrolling row of chips for them (crowded, and a desktop idea squeezed small),
and removing top-bar search on phones were tried and rejected:
they made the phone a different product from the desktop and removed
functions instead of adapting them.
