# Shared UI package

Read the repository-root `AGENTS.md` first. This package owns reusable Pythia
UI primitives, semantic presentation, theme/profile behavior, and the small
set of approved runtime identity assets. It does not own routes, product data,
validation, submission state, or workflows.

Keep exports source-first and framework-neutral. Base UI is the primary
primitive family; `cmdk`, React DayPicker, and `react-resizable-panels` retain
their native keyboard, focus, dismissal, selection, calendar, and resize
behavior. Keep `"use client"` on browser-only modules rather than the package
barrel.

Style with Tailwind utilities in the component, following the
[styling rule](../../.agents/rules/styling.md) and [ADR 0007](../../docs/decisions/0007-tailwind-styling-layer.md).
`src/styles.css` is the only stylesheet: it owns the `--py-*` tokens and maps
them into Tailwind's theme. Use those theme names, merge classes with `cn`,
and give every root a `data-slot`. Do not add consumer palettes or make color
the only status cue. Signal Amber identifies a Pythia signal; warnings and
general interaction use their own semantic roles.

Tests belong in `test/`. Every public component should document its purpose,
props and variants, meaningful states, profile/theme behavior, accessibility,
and one concise ownership boundary beside the export.
