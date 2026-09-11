---
description: "Keep the claude.ai/design export of @pythia/ui truthful: re-sync after component changes and keep the safelist, conventions header and token theme in step."
paths:
  - "packages/ui/src/**/*"
  - ".design-sync/**/*"
globs:
  - "packages/ui/src/**/*"
  - ".design-sync/**/*"
---

# Design-system sync

`@pythia/ui` is exported to a Claude Design project so that tool composes
screens from the real components instead of generic ones. The export is
generated; `.design-sync/` holds the hand-authored inputs and is committed.

## Which surface answers which question

- **Design Lab** (`apps/design-lab`) — is this *component* right? It renders the
  real components in the real build. Component work belongs here.
- **Claude Design** (the synced project) — is this *screen* right? Layout, flow
  and composition, using the same components.
- **Desk** (`apps/desk`) — the product.

Claude Design is a design surface, not a source of truth. Components are changed
in `packages/ui` and re-synced; never the other way round. Do not add a second
export pipeline, a registry generator, or a runtime dependency on the design
service — the sync is a development-time export run on request.

## Ownership

| Path | Owner |
| --- | --- |
| `.design-sync/previews/<Name>.tsx` | Hand-authored, committed. One file per component; each named export is one preview cell. |
| `.design-sync/config.json`, `NOTES.md`, `conventions.md`, `docs/` | Hand-authored, committed. |
| `ds-bundle/`, `.ds-sync/`, `.design-sync/.cache/` | Generated, ignored. |

Never hand-edit a generated `<Name>.html`, `.d.ts` or `.prompt.md`; a rebuild
overwrites them. Fix the preview `.tsx`, the source docstring, or the config.

Previews are **composition, not reimplementation**: realistic props and children
for components that already exist. If a preview needs markup the component does
not render itself, fix the composition or the component — do not hand-write a
lookalike. Keep example content clearly synthetic, as the Design Lab does.

## Re-sync after component changes

Re-sync whenever `packages/ui` changes shape or appearance. The uploaded bundle
and stylesheet are compiled from source at sync time, so an unsynced change
simply does not exist for the design tool, and a design built against a stale
export will not match the code. `.design-sync/NOTES.md` carries the current
command and the repo-specific setup it needs.

## Adding a theme name is a three-file change

`styles.css` uses `@theme inline`, so Tailwind emits no `--color-*` variables
and generates only utilities it has seen used. A new `@theme` name therefore
needs all of:

1. the `@theme` block in `packages/ui/src/styles.css` (the token itself),
2. `theme-scale.ts` for non-color names, so `cn` merges them (see the
   [styling rule](./styling.md)),
3. the `@source inline(...)` safelist in `.design-sync/tailwind-entry.css` and
   the vocabulary table in `.design-sync/conventions.md`.

Miss the safelist and designs using the name render unstyled with no error
anywhere; miss the conventions header and the design tool never learns the name
exists. The safelist should be re-derived from the `@theme` block rather than
edited by hand.

## conventions.md is model-visible text

`.design-sync/conventions.md` is prepended to the generated README and reaches
the design tool as instructions, so it follows
[prompting guidance](../../docs/prompting.md) and the
[instruction rule](./agent-instruction-design.md). Every class, token, component
and prop it names must exist in the built export — validate against the compiled
stylesheet and the generated `.d.ts` files before shipping a change. A
conventions file that names something unreal is worse than none: it will be
trusted, and the resulting output fails silently.

It is also the correct place to correct systematic design output. Change the
guidance rather than fixing each generated design.

## Known export limits

Brand artwork cannot ship. `brandAssetUrls` resolves through
`new URL(..., import.meta.url)`, which the export's bundle cannot satisfy, so
`PythiaLockup` is excluded from the exported components and the conventions
header tells the tool not to use it. Do not "fix" this by converting the assets
to static imports; that changes their type under Next and breaks the apps.
