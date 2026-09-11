# `@pythia/ui`

The source-first UI package shared by Pythia applications. It provides ordinary
interface primitives, financial and research semantics, Public/Product design
profiles, theme handling, and the approved runtime identity assets.

Applications still own their routes, layouts, links, data, validation,
submission state, and workflows. The package has no Next.js APIs or product
state.

## Use it in a Next.js app

Declare `@pythia/ui` as a `workspace:*` dependency, transpile it, import its
stylesheet, and let Tailwind scan its source:

```js
// next.config.mjs
export default { transpilePackages: ["@pythia/ui"] };
```

```css
/* src/app/globals.css, from a first-level app */
@import "tailwindcss";
@import "@pythia/ui/styles.css";
@source "../../../../packages/ui/src";
```

Set `data-pythia-profile="public"` or `"product"` on the root element. Use
`THEME_BOOTSTRAP_SCRIPT` before first paint and `useThemePreference()` for the
persisted `light | dark | system` control. Use `PythiaLockup` for the complete
approved identity rather than copying or recomposing image assets.

## Package contract

- Use semantic/profile tokens rather than application-specific palettes.
- Public calendar values are validated `YYYY-MM-DD` strings. Native dates stay
  inside the DayPicker adapter.
- Preserve the native accessibility behavior of Base UI, `cmdk`, React
  DayPicker, and `react-resizable-panels`.
- Use the combobox list-level `density` variant for compact result sets; items
  inherit their list density.
- Use `SearchSelect` when the closed control should display its value and the
  search input should appear at the top of the popup. Its result list is compact
  by default.
- Keep browser-only entrypoints narrowly marked `"use client"`; the package
  barrel remains server-compatible.
- Keep labelled synthetic showcase data in the consuming app, never here.

The checked `apps/design-lab` workspace is the interactive development
reference. It is deliberately unavailable in production and is not a Pythia
runtime dependency.

## Assets

The package contains four IBM Plex Sans webfont weights, the Inter variable
reading face (Latin subsets, upright and italic, `src/assets/OFL-Inter.txt`), four bounded Pythia
lockups, and a favicon. It does not contain brand masters or a general asset
kit. The font files are distributed under the SIL Open Font License 1.1; see
`src/assets/OFL.txt`.

## Checks

From the repository root:

```sh
pnpm --filter @pythia/ui check
pnpm --filter @pythia/ui test:unit
pnpm --filter @pythia/ui build
```
