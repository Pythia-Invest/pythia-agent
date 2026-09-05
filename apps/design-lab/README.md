# Design Lab

The Design Lab is the local interactive showcase for `@pythia/ui`. It helps
contributors inspect themes, profiles, component states, keyboard behavior,
and synthetic financial/research compositions while developing Pythia.

Run it with hot reload from the repository root:

```sh
pnpm --filter @pythia/design-lab dev
```

The Lab is intentionally development-only. Its examples are labelled
synthetic, its package has no production start command, and every route returns
`404` when `NODE_ENV=production`. Pythia applications may depend on
`@pythia/ui`; they must not import this app or its fixtures.

Focused checks:

```sh
pnpm --filter @pythia/design-lab check
pnpm --filter @pythia/design-lab test:unit
pnpm --filter @pythia/design-lab build
```
