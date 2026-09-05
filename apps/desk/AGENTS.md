# Pythia Desk

Read the repository-root `AGENTS.md`, `runtime/contracts/hermes.md`, and this
app's `README.md` before changing Desk.

Hermes owns sessions, history, runs, approvals, cancellation, tools, skills,
and model execution. Desk is a loopback browser interface and a narrow
server-side adapter to those native APIs. Do not add another agent loop,
session store, retry queue, capability state, or browser-visible Hermes
credential.

Every browser API route must enter through `src/server/routes.ts`. Admission in
`src/server/admission.ts` runs before reading request state or calling Hermes.
Do not add a bypass route. Keep upstream response handling narrow and tolerant
of absent optional fields; unknown Hermes events are ignored.

Use `@pythia/ui` through its public entrypoint. Application routes, state,
validation, and workflows stay in this app. Tests live in `test/`.

Check affected workflows with keyboard navigation, narrow viewports and their
loading, empty and failure states. Use the supported-environment scope in
`docs/support.md`; a working local browser is not evidence for every browser.
Hosting options remain optional configuration, never personal machine defaults.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
