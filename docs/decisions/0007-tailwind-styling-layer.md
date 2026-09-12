# 0007: Tailwind utilities over the Pythia token theme

## Context

The shared package and Desk grew two styling systems side by side: BEM
stylesheets per component directory, and Tailwind utilities that reached the
same tokens through arbitrary values such as `bg-[var(--py-surface-raised)]`.
Each new component had to choose, consumers could not override a component
without knowing which system it used, and the design tokens were referenced by
name in dozens of places with no single vocabulary.

## Ruling

Tailwind CSS 4 is the styling layer for `@pythia/ui` and every application.

- `packages/ui/src/styles.css` is the only stylesheet in the shared package. It
  declares the `--py-*` primitive, semantic, and profile tokens; maps the
  semantic roles into Tailwind's `@theme` under short role names (`bg-raised`,
  `text-foreground-secondary`, `border-border`, `rounded-control`,
  `h-control`, `bg-primary`, `text-signal`); defines the `dark` and `public`
  variants from the root attributes; and adds the few token-bound utilities
  Tailwind has no namespace for (`opacity-disabled`, `motion-fast`,
  `motion-standard`, `numeric`).
- Components style themselves with utilities in TSX, compose class names with
  `cn` (`clsx` plus `tailwind-merge`) so a consumer `className` wins, express
  variants with `cva` or a typed record, and take state from the primitive's
  own `data-*`/`aria-*` attributes. Every root carries a `data-slot`.
- Applications keep one global stylesheet that imports Tailwind, imports
  `@pythia/ui/styles.css`, and points `@source` at the shared package. Their
  components use the same utilities and `cn`.
- The identity lockup renders the approved PNG exports through `<img>` with
  theme-conditional visibility instead of a background-image rule.

## Rationale

One system means one place to learn, one override mechanism, and utilities
that read as the token vocabulary the design direction defines. Mapping the
existing `--py-*` roles into `@theme` keeps the token contract, the contrast
tests, and the Design Lab's own stylesheet intact while removing the arbitrary
value escapes. `tailwind-merge` makes composition predictable without
specificity games. `data-slot` gives tests and consumers a stable hook that is
not a layout class.

## Consequences

About 2,300 lines of component CSS were removed; the same behavior now lives in
the component files. Tests assert on `data-slot` attributes and on semantic
class names in source rather than on CSS rules. Consumers that targeted BEM
classes (the Design Lab's `.pythia-lockup` and `.pythia-sidebar` hooks) target
`[data-slot]` instead. `tailwind-merge` is a runtime dependency of the shared
package. Base UI transition states use `data-starting-style:` and
`data-ending-style:` variants; library-owned CSS variables (drawer swipe,
toast index, anchor width) remain arbitrary values because Tailwind has no
namespace for them.

## Rejected alternatives

CSS Modules per component (a second system, no shared vocabulary, no merge
semantics); keeping BEM stylesheets and only cleaning up the Tailwind side
(preserves the split); `@apply` recipes in CSS (hides the utilities from the
component and reintroduces stylesheet growth); raw `--py-*` variables in
arbitrary values (verbose, unmergeable, and not what Tailwind's theme is for);
and a runtime CSS-in-JS library (unnecessary dependency and a Next.js RSC
constraint).
