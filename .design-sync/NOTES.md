# design-sync notes — @pythia/ui → claude.ai/design

Repo-specific gotchas for future syncs. Read this before re-running the driver.

## Build shape

- **The package emits types only.** `packages/ui/build.mjs` runs `tsc` with
  `emitDeclarationOnly`, so `dist/` holds `.d.ts` and no JS. The converter is
  pointed at the TypeScript source instead — `--entry ./packages/ui/src/index.ts`
  — and its esbuild bundles it. Do not "fix" this by adding a JS emit to the
  package; nothing else in the repo needs one.
- `--node-modules packages/ui/node_modules` (react and react-dom both resolve
  there; the repo root is not needed).

## The stylesheet has to be compiled first

`packages/ui/src/styles.css` is tokens, `@font-face` and the Tailwind theme
only. The utility classes the components actually use are generated at *app*
build time from `@source`. Shipped as-is, every card renders unstyled.

`.design-sync/tailwind-entry.css` compiles the same closure the apps compile
into `packages/ui/dist/design-sync.css`, wired as `cfg.cssEntry`. `cfg.buildCmd`
chains it after the package build (order matters — `build.mjs` deletes `dist/`
first) and copies the woff2 files to `dist/assets/` so the `@font-face`
`url("./assets/…")` references resolve from the compiled sheet's location.

Tailwind resolves `@import "tailwindcss"` from the entry file's own directory,
so `.design-sync/node_modules` must be symlinked at `../.ds-sync/node_modules`.
It is gitignored — recreate it on a fresh clone:

    ln -sfn ../.ds-sync/node_modules .design-sync/node_modules

## Preview glue vocabulary (important)

Preview authors may use **only** the utility classes safelisted in the
`@source inline(...)` block of `.design-sync/tailwind-entry.css`, plus whatever
the components style themselves. Reason: a scoped `preview-rebuild.mjs` does
**not** re-run Tailwind, so a class introduced by a preview without a safelist
entry renders unstyled and sends the author chasing a phantom bug. Adding a
class to a preview means adding it to that block and recompiling.

Semantic colour utilities available: `text-foreground`,
`text-foreground-secondary`, `text-foreground-disabled`, `bg-canvas`,
`bg-container`, `bg-raised`, `bg-subtle`, `border-border`, `border-border-strong`.

## Composition sources

`apps/design-lab/src/app/examples/previews-*.tsx` holds a curated, author-written
composition per component and is the primary source for authored previews — port
from it rather than inventing. Its `catalog-*` class names come from the
design-lab's own stylesheets and are **not** in the synced CSS; replace them with
the glue vocabulary above. `apps/design-lab/src/app/demonstrations/` holds
full-surface compositions, useful for realistic content.

## Component scope

144 PascalCase exports, of which 67 are real components. `cfg.componentSrcMap`
nulls the 77 compound parts (`SelectItem`, `BreadcrumbLink`, `SidebarSection`,
`TabsList`, …) so they don't get lonely cards — they are composed inside their
parent's preview instead. All 144 still ship in `_ds_bundle.js` and stay
importable; the exclusion only removes the card.

29 entries in the same map pin a src path for components that share a file with
a sibling (`actions/button.tsx` exports Button, IconButton, LinkButton,
ButtonGroup), which is what gives them the right group.

`Calendar` and `PythiaLockup` are grouped via tiny `.design-sync/docs/*.md`
frontmatter stubs: group is derived from the last src directory that isn't the
component's own name, so `calendar/calendar.tsx` would otherwise land in
`general`, and `lockup.tsx` sits at the src root.

## Known render warns

- `[TOKENS_MISSING]` no longer fires. The Base UI runtime variables
  (`--toast-*`, `--accordion-panel-height`, `--collapsible-panel-height`) now
  carry resting fallbacks at source, so the compiled stylesheet has no dangling
  references. Keep it that way: a `var(--x)` with no fallback for a variable
  Base UI writes at runtime is invalid until the first measurement, and any tool
  reading the stylesheet reports it as undefined.
- `[DOCS_UNMAPPED]` for most components: the package ships no per-component
  docs, so `.prompt.md` is synthesized from the `.d.ts` and the authored
  preview. Expected.
- The large grey area under each cell in `_screenshots/review/*.png` is the
  capture harness's fixed story viewport, not a card defect. `[GRID_OVERFLOW]`
  is the check that would catch a real one.

## Sizing a preview: use inline `style`, not a utility

The safelist deliberately carries no numeric `h-*` / `w-*` scale. When a preview
needs a definite box — `ScrollArea` needs a height to show a scrollbar, a
vertical `Separator` needs something to stretch against, a fixed-width scroll
tile — put it in an inline `style={{ height: 240 }}` on a plain wrapper div.
Three separate authors reached this independently. It sidesteps the
scoped-rebuild problem entirely (inline styles need no Tailwind pass) and keeps
the safelist from growing a whole spacing scale that only previews use.
`Skeleton` sizes the same way: it spreads native props, so `style` works
directly on the component.

## Ground surface components on `bg-canvas`

`Card`'s `raised` surface is `#fdfdfd` — effectively invisible on the capture
harness's white body, so its variant axis reads as "three identical cards".
Surface-level components need a `bg-canvas` wrapper for the variants to show.

## The generated `.d.ts` under-reports the real prop surface

Two known cases, both worth reading the src file for rather than trusting the
generated contract:

- `Input` and `Textarea` flatten away their `Omit<BaseInput.Props, …>` /
  `ComponentPropsWithRef<"textarea">` spread, so `placeholder`, `readOnly`,
  `rows` and `inputMode` are absent from the `.d.ts` despite working.
- The compound namespaces (`Accordion`, `Collapsible`, `Details`, and the other
  `X.Root`/`X.Item` objects) erase to `[key: string]: unknown`, because the
  extractor sees an object literal, not a component. `cfg.dtsPropsFor` now
  carries hand-written bodies for those three; if a future sync adds compound
  components, expect the same and extend that map.

This matters beyond preview authoring: `<Name>.d.ts` is the API contract the
design agent codes against, so an erased one makes it guess.

## Source fix applied during the first sync

Vertical `Separator` used `h-full`, which resolves against an auto-height flex
parent and collapses to zero — the component rendered invisible in the ordinary
case. Changed to `w-px self-stretch` in
`packages/ui/src/data-display/separator.tsx`. Only the design-lab consumed it.

## Brand artwork cannot ship through this pipeline

`PythiaLockup` is excluded from the card set (`componentSrcMap: {"PythiaLockup": null}`)
and must stay excluded. `packages/ui/src/assets.ts` builds every brand URL with
`new URL("./assets/…", import.meta.url)` — the correct portable pattern — but the
converter has to `define` `import.meta.url` as `"https://ds-preview.invalid/"` to
produce an IIFE bundle, so the rasters resolve to an unreachable host. The
`.png: dataurl` loader never applies because the files are referenced at runtime,
not `import`ed.

Do not "fix" this by changing `assets.ts` to static imports: under Next those
return a `StaticImageData` object rather than a string, which breaks the favicon
in both `apps/desk` and `apps/design-lab`. The two converter-side fixes both
require forking `lib/bundle.mjs`, which the skill forbids. Anything else routed
through `brandAssetUrls` has the same defect.

`.design-sync/conventions.md` tells the design agent not to reach for it.

## Component API notes worth keeping

Collected while authoring previews; each cost at least one iteration.

- `Toggle` takes `label` and `icon` as **props, not children**.
- Lucide icons default to 24px and there is no global `svg` sizing rule — pass
  `size={16}` explicitly. Only `IconButton` sizes its child (`[&>svg]:size-4`).
- `ButtonGroup` is a `<fieldset>` and requires `label`. It strips inner radii via
  `[&>*:not(:first-child)]`, so children must be **direct** — wrapping one in a
  div breaks the seam.
- `defaultValue` is an array for both `ToggleGroup` and `Accordion.Root`, even in
  single-selection mode.
- `LinkButton` has no `danger` variant (`Exclude<ButtonVariant, "danger">`).
- `ResizablePanel` string sizes are percentages, numbers are pixels. Panels and
  separators must be direct children of the group.
- `Container` applies `px-gutter` itself — a wrapper adding horizontal padding
  doubles the gutter.
- `Calendar` and `DatePicker` throw a `TypeError` on anything that is not
  `YYYY-MM-DD`; pass `"2028-04-01" as CalendarDateString` and an explicit
  `today` so captures are deterministic.
- `Progress` with `max` formats as a percentage, not a fraction — a fraction
  belongs in `label`.
- `Table` wraps itself in `overflow-x-auto`, so it does not need `cardMode: column`.

## Capture-harness limits (not defects)

- Stories render at 900×700 unless the card declares a `viewport`, which preview
  authors cannot set. `Container`'s measures are character-based, so at 900px
  three of its four sizes collapse to one width; its `Measures` story reduces
  font-size to keep the 1 : 1.5 : 2 ratio visible and says so in a caption.
  A per-card viewport override would let it render at true scale (~1400px).
- Captures are light-theme only. `PythiaLockup` swapped artwork via
  `dark:hidden` / `hidden dark:block`, so dark artwork was never exercised.
- No card can show `InputGroup`'s `focus-within` ring — arguably the most
  distinctive part of the forms styling.
- Animations (Skeleton shimmer, ActivityIndicator spin, panel height
  transitions) freeze mid-frame. Expected.

## Overlays: `cardMode: single`, and never an explicit `viewport`

Everything in the overlays group portals its open content to `document.body`, so
a grid card shows nothing or a stray floating panel. `cardMode: "column"` does
not help — a portaled popup is not in the cell at all. `cardMode: "single"` is
the only mode that works, and every overlay is configured that way with the open
state as its primary story.

**Do not add a `viewport` key to those overrides.** `emit.mjs` already defaults
single-mode cards to 900×700, which is the viewport the grades were minted at.
An explicit `viewport` enters the *keyed* override slice and would clear every
overlay verdict for zero pixel change.

## Overlay authoring gotchas

- Every overlay root, including `Menu.SubmenuRoot`, supports `defaultOpen` — open
  states need no hooks.
- **`Menu.GroupLabel` throws outside `Menu.Group`**, and the throw happens inside
  React render, so the cell captures completely blank with no error text on the
  sheet. A blank menu cell almost always means this.
- **Only one Tooltip can be open at a time** — Base UI coordinates globally, no
  provider involved. A four-sides-in-one-story sweep silently renders one
  tooltip; vary the side across cells instead.
- `swipeDirection` on Drawer/Sheet names the **dismissal gesture, not the edge**:
  `"left"` mounts on the right.
- `ContextMenu` seeds a zero-rect anchor at (0,0), so `defaultOpen` alone pins the
  popup to the page corner. Pass
  `anchor={{getBoundingClientRect: () => new DOMRect(x, y, 0, 0)}}` on the
  positioner for a deterministic pointer position.
- Open popups pick up a `[tabindex]:focus-visible` outline in capture: Base UI
  focuses the popup, and with no prior user interaction Chrome treats it as
  keyboard focus. Previews add `outline-0` (already compiled via
  `overlayClasses.positioner`, so scoped-rebuild safe).

## Known library defects found while authoring — not preview artifacts

Recorded here because each one silently produces wrong output rather than an
error. None are fixed except where noted.

- **`X.Arrow` renders nothing** across every overlay. `overlayClasses.arrow`
  ships fill/stroke colours but no shape and no per-side rotation, and Base UI's
  `Arrow` is an empty div expecting an author-supplied SVG. Anyone writing
  `<Menu.Arrow />` gets an empty div. All arrows were removed from the stories.
- **`Dialog.Close render={<Button variant="primary" />}` renders wrong.** Base
  UI's `mergeProps` concatenates class names instead of running tailwind-merge,
  so CSS source order lets `overlayClasses.close`'s `bg-transparent`/`border-0`
  beat any filled variant. Only `variant="ghost"` survives. The same latent
  collision exists in `apps/desk/src/components/chat/model-manager-dialog.tsx`,
  invisible only because a close X wants to be transparent.
- **`FinancialValue.label` renders into an `sr-only` `<figcaption>`**, so stacked
  values read as anonymous figures. The design-lab's convention — a visible
  caption span above each figure — is what the previews use.
- **`Sidebar` hard-codes `min-w-56`**, so a collapsed rail is not reachable by
  utility. Inline `style={{ minWidth: 0, width: 64 }}` works (it spreads native
  `aside` props).
- **FIXED in this sync**: `RadioGroup` and `NavigationMenu` both styled off a
  `data-orientation` attribute that Base UI never writes — Base UI's radio group
  has no `orientation` prop at all (only `data-disabled`), and
  `NavigationMenu.Root` keeps `orientation` in context for arrow keys without
  emitting the attribute. Both now own the prop and write the attribute, which
  activates CSS that had been dead. `Tabs` was always correct because
  `Tabs.Root` genuinely exposes `data-orientation`.

## Safelist classes authors asked for and did not get

Left out deliberately — each was worked around without loss. Add only if a real
composition needs them: `underline`, `decoration-dotted`, `underline-offset-*`,
`cursor-help`, `border-y`, and a numeric `h-*`/`w-*` scale (use inline `style`).

## The safelist and conventions.md are one contract

`@theme inline` means Tailwind never emits `--color-*` variables — it inlines the
`--py-*` values into utilities — and Tailwind only generates a utility it has
seen used. So the shipped stylesheet would otherwise carry only the classes the
library and the previews happen to use, and a design written with a perfectly
legitimate theme name (`text-impact-favorable`, `bg-atmosphere`,
`max-w-measure`) would render unstyled with no error anywhere.

`.design-sync/tailwind-entry.css` therefore safelists the **complete** theme
vocabulary — every `--color-*`, `--radius-*`, `--spacing-*`, `--text-*`,
`--leading-*`, `--font-*` and `--shadow-*` name from the `@theme inline` block —
and `.design-sync/conventions.md` documents exactly that set to the design agent.

**When `styles.css` gains or renames a theme name, both files must change.** Add
it to the safelist or designs cannot use it; add it to conventions.md or the
agent will not know it exists. A re-sync should re-derive the safelist from the
`@theme inline` block rather than trusting the existing list.

Validate before shipping: compile the sheet, then grep every class conventions.md
claims, and check every component and prop it names against
`ds-bundle/components/<group>/<Name>/<Name>.d.ts`. That pass caught two wrong
props in the first draft — `Stack gap="group"` (the real scale is numeric) and
`Badge tone="information"` (Badge uses `info`; only SemanticMessage uses
`information`).

## Custom properties in the compiled stylesheet are not all tokens

The synced stylesheet is compiled Tailwind, so it legitimately contains three
different kinds of custom property. A consumer auditing it will see all of them:

- `--py-*` — the actual design tokens. This is the set worth auditing.
- `--tw-*`, `--animate-*`, `--default-transition-*` — Tailwind internals.
  The `--tw-*` ones are declared with `@property`, not as ordinary declarations,
  so a scanner that only looks for `--x:` inside rule bodies reports every one
  as undefined. They are defined.
- Third-party runtime variables — Base UI writes these on the element. They now
  all carry fallbacks (above), but new ones will not unless the author adds them.

Reports of "undefined variables" against the export are usually this. Verify by
grepping both the definition and the reference before changing anything, and do
not narrow `cfg.cssEntry` to avoid them: the compiled output is the whole point,
and excluding it renders every design unstyled.

## Re-sync risks

- **The compiled stylesheet is a build artifact, not a source of truth.** If
  `packages/ui/src/styles.css` gains a token or a component starts using a new
  utility, the sheet must be recompiled (`cfg.buildCmd` does it) or designs
  silently render against a stale palette.
- **The safelist is hand-maintained and load-bearing.** It will drift from both
  the theme block and from what previews use. A preview — or a generated design
  — that renders unstyled is almost always a missing safelist entry, not a
  broken component. See the safelist/conventions contract above.
- `.design-sync/node_modules` is a gitignored symlink the committed setup
  depends on — recreate it per clone (see above).
- Overlay components were previewed in their **closed/trigger** state where the
  open state would portal out of the card. If a future sync wants open states,
  they need `cfg.overrides.<Name>: {"cardMode":"single","viewport":"WxH"}`.
- The converter is pointed at TypeScript source, so a type-level regression in
  `packages/ui/src` surfaces as a bundle failure rather than a build failure.
