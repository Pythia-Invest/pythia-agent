# 0025: Contrasting navigation with the existing Desk palette

## Context

Desk's route and panel backgrounds lacked a consistent hierarchy. A continuous
canvas made the application feel monotonous; replacing the original blue-leaning
greys with neutral greys was also rejected. The selected direction gives the
navigation greater contrast while preserving the existing palette.

## Decision

Keep the shared colour tokens unchanged. Desk composes them into these roles:

- Navigation uses the existing dark theme, including its text, controls and
  brand artwork. In a light page its background is dark canvas; in a dark page
  it uses the raised dark surface and a fine dividing edge. The expanded rail
  is 200px wide; collapsed navigation and the mobile drawer remain supported.
- The global top header uses canvas with a quiet dividing line. Search retains
  its raised background and explicit focus treatment.
- Every routed workspace uses the same canvas, including Chat, Workspace,
  Settings and placeholder destinations. `DeskShell` owns that background and
  foreground once; route content and resizable layout wrappers stay transparent.
  Pages do not select their own background. The assistant panel and bounded
  controls use raised surfaces. Contextual navigation, including chat history,
  inherits its host surface.
- The desktop assistant has one full-height, 1px separator at its boundary,
  starting below the shared header. The native resize library expands the hit
  target independently of the visible line. There is no separate assistant
  border or blank gutter. Hover, active resizing and keyboard focus retain
  visible affordances. Tabs keep a raised selected background and use a quiet
  underline so the active item remains distinct without heavy repeated edges.

The navigation frame follows the page theme through CSS, while its inner
sidebar scopes the existing dark tokens. It does not add theme persistence,
another theme controller, hydration-dependent colour choices or new tokens.
The mobile navigation drawer scopes the existing dark theme across both
navigation and its session list, avoiding a dark-to-light seam inside one sheet.

The shared `ChatView` and `NewChat` components inherit their host's surface when
used in the main workspace or auxiliary assistant panel. Their composer and
bounded messages retain their own component roles. This avoids chat-specific
route styling or duplicating a page-surface component solely to assign a colour.

## Rationale and consequences

The contrasting rail provides a stable visual anchor without changing Pythia's
palette or adding decorative effects. Fine boundaries distinguish functions.
Browser-owned panel widths and open states continue to take precedence over
defaults, including layout restoration before application hydration.

## Rejected alternatives

- One background across the workspace and every panel: insufficient hierarchy.
- A neutral-grey replacement palette: rejected visual identity change.
- An inset main workspace: a quieter alternative, but less regional contrast.
- An inset assistant panel: gives the assistant more visual emphasis than the
  selected composition needs.
- Blur, gradients or shadows on persistent panels: unnecessary for this choice.
