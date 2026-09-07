---
description: "Style shared UI and applications with Tailwind utilities over the Pythia token theme, never per-component CSS."
paths:
  - "packages/ui/src/**/*"
  - "apps/*/src/**/*.tsx"
  - "apps/*/src/**/*.css"
globs:
  - "packages/ui/src/**/*"
  - "apps/*/src/**/*.tsx"
  - "apps/*/src/**/*.css"
---

# Styling

Read [ADR 0006](../../docs/decisions/0006-tailwind-styling-layer.md) and the
[design direction](../../docs/design.md) before changing appearance.

Style in the component with Tailwind utilities. `packages/ui/src/styles.css`
is the only stylesheet in the shared package: it declares the `--py-*` design
tokens and maps them into Tailwind's theme. Applications keep one global CSS
file that imports Tailwind, imports `@pythia/ui/styles.css`, and adds
`@source` for the shared package; it holds no selectors of its own.

Use theme names, not raw values or token variables:

- Surfaces `bg-canvas`, `bg-raised`, `bg-subtle`, `bg-overlay`, `bg-container`.
- Text `text-foreground`, `text-foreground-secondary`,
  `text-foreground-disabled`; type `text-body`, `text-reading`, `text-xs`.
- Borders and interaction `border-border`, `border-border-strong`,
  `bg-interaction-hover`, `bg-interaction-active`, `outline-ring`.
- Actions `bg-primary` with `text-primary-foreground`.
- Status `info|success|warning|error` as `text-*`, `border-*-border`,
  `bg-*-surface`. Signal Amber is `signal` and marks only a Pythia signal.
- Geometry `rounded-control`, `rounded-container`, `rounded-pill`,
  `h-control`, `px-gutter`, `max-w-measure`; motion `motion-fast`,
  `motion-standard`; disabled `opacity-disabled`; elevation `shadow-popup`,
  `shadow-overlay` for floating surfaces only.

Do not write `#hex`, `rgb()`, `[var(--py-…)]` arbitrary values, `@apply`, CSS
modules, BEM classes, or `[data-theme="dark"]` overrides in components; add a
missing role to the `@theme` block in `styles.css` instead. Arbitrary values are
acceptable only for geometry Tailwind cannot express, such as a library's own
CSS variables.

Merge class names with `cn` from `@pythia/ui`, consumer `className` last, so
overrides win. Express variants with `cva` or a typed record, and drive state
from the primitive's own attributes (`data-checked:`, `data-active:`,
`aria-invalid:`, `disabled:`) rather than component state classes. Give every
component root a `data-slot` attribute and target that in tests and consumer
styling; never assert on utility class strings that describe layout.

Theme and profile are root attributes, so use the `dark:` and `public:`
variants defined in `styles.css`, not media queries. Keep the `--py-*` variable
names, their light/dark blocks, and their order stable; tests parse them.
