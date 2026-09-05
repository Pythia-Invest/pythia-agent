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
belong in `packages/ui`.

Next.js APIs can change between versions. Before changing framework behavior,
read the matching guide in this workspace's installed `next/dist/docs`.
