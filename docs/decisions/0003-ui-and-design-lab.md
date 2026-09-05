# 0003: Shared UI and development-only Design Lab

`@pythia/ui` is the source-first home for reusable Pythia interface primitives,
semantic presentation, theme/profile behavior, and approved runtime identity
assets. Applications own routes, data, validation, and workflows.

`@pythia/design-lab` is a checked development workspace in the same repository
so UI changes can be explored with hot reload on macOS and Ubuntu. Its content
is stable and visibly synthetic. The Lab has no production start command,
service, installer entrypoint, or runtime dependency, and its root layout
returns `404` in production.

Runtime consumers use explicit allowlists. Desk may import `@pythia/ui`, but no
application may import the Design Lab, its fixtures, or its build output. The
Lab is likewise excluded from Hermes scan roots, plugin copies, PATH entries,
and model input.
