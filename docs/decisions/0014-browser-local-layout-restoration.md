# ADR 0014: Browser-local layout before first paint

## Context

Desk remembers navigation visibility and dock geometry in localStorage. Restoring
these preferences in a mount effect first displays the default layout, then moves
content after hydration. The server cannot read browser localStorage. Future
persisted panels need one consistent restoration mechanism.

## Decision

Desk owns a small declarative layout utility in `src/layout/local-layout.ts`.
Each store declares its storage key, boolean attributes, and bounded numeric CSS
properties. The root layout registers those definitions in a synchronous inline
head bootstrap, alongside the existing theme bootstrap. Bootstrap and runtime
use the same validation and projection functions. Existing shell preferences
retain their key and format.

The bootstrap applies validated preferences to the document root before the body
paints. Components keep stable server and initial hydration markup and express
visibility and geometry with Tailwind selectors. Only the root has the existing
hydration-warning suppression for bootstrap-owned attributes. Suppression does
not repair mismatched component markup and must not be added to consumers.

React subscribes through `useLocalLayout`, which supplies a stable default server
snapshot and a cached browser snapshot. Changes project immediately, persist when
storage is available, and notify subscribers. Storage events synchronize other
tabs. Missing, malformed, or unavailable storage uses defaults; blocked writes
still allow in-memory interaction.

Resizable panels keep the native `react-resizable-panels` implementation.
`useRestoredPanel` transfers the saved size to its imperative handle in a layout
effect before releasing the initial CSS geometry override. Consumers keep native
`defaultSize` stable and save only completed user resizes, not pointer movements
or initialization callbacks. Responsive dock markup keeps the main content in
the same parent through hydration and breakpoint changes.

## Consequences and alternatives

This covers the navigation rail, chat-list visibility, and chat-dock visibility
and width. New persisted layout surfaces can register additional schemas and use
the same hooks. Schemas are restricted to presentation booleans and bounded
geometry; chat sessions, file tabs, research, drafts, and other application records
do not belong in the pre-paint bootstrap.

There is no dependency, network lookup, or server preference store. Preferences
remain local to the browser and origin, including a remote Tailscale origin.
Cookies could let the server render saved preferences, but introduce request
state and another persistence path for this browser-local concern. Hiding the
whole shell until hydration avoids movement by delaying useful content; the
pre-paint projection preserves immediate layout instead.

Serialized bootstrap functions must remain self-contained. Unit checks execute
the generated script independently; browser checks delay application scripts to
verify layout before hydration, then exercise native resizing and mobile layout.
