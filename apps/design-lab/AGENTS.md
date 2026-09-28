# Design Lab

Read the repository-root `AGENTS.md` and `README.md` in this directory before
changing the Lab.

This app is a development-only, interactive showcase for `@pythia/ui`. Keep
all examples stable, visibly labelled as synthetic, and limited to component
presentation. It is not product documentation, a registry generator, a real
product screen, or a source of Desk workflows.

Every production route must return `404`. Do not add a production start
command, service, installer entrypoint, runtime dependency, Hermes scan root,
or model-visible input for this app. Desk may consume `@pythia/ui`; it must not
consume the Lab.

Use shared tokens and components before adding app-local styling. App-local
code may compose components and synthetic fixtures, but reusable primitives
belong in `packages/ui`. A composition demonstration may also render a feature
package's shared UI, such as `@pythia/market-data/search-ui`; its synthetic
fixtures stay in the Lab and the feature never imports them.

Next.js APIs can change between versions. Before changing framework behavior,
read the matching guide in this workspace's installed `next/dist/docs`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
