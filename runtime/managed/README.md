# Managed runtime

This directory is Pythia-owned source updated with each release:

- `runtime/managed/plugin/operating.py` is the authoritative release-owned
  source for the small always-on operating context registered by the Pythia
  plugin.
- `skills/` is loaded directly by Hermes through `skills.external_dirs`; native
  bundle references, scripts, templates, and assets remain beside `SKILL.md`.
- `plugin/` is copied, never linked, into the selected Hermes profile.
- `plugins/market-data/` is a separately copied native feature: shared financial
  contracts, identity, source resolution, protected resident HTTP/SSE and reusable
  connector execution helpers. This payload includes no concrete shared connector;
  existing core SEC/EOD capabilities remain independent.
- `runner/` contains the bounded SEC/EODHD adapters and the narrow native
  read-only session-context helper, run with the pinned Hermes environment.
- `python/` pins the unmodified Python runtime dependencies.

The profile, credentials, sessions, knowledge, caches, settings, and capability
choices live outside this checkout. Editing managed source creates a local fork:
an agent must explain the exact edit and its update consequences, then receive
explicit approval before changing it. This is advisory, not an access-control
boundary.

`runtime/seeds/profile/SOUL.md` is a create-once starting point, not a second
release-owned prompt authority. After initialization, the installed SOUL is
user-owned and updates preserve it.

The plugin's `desk_view.py` exposes bounded recent structured Desk context through
`pythia_desk_view`; the fresh API-server toolset is `pythia-desk`. Native tool
settings and native deferred tool discovery remain authoritative. The operating
section `[PYTHIA_WORKSPACE_GUIDANCE_V1]` explains native memory, files, sessions
and skills; `investment-memory` carries research discipline using native files.
No new index, memory-provider integration or mandatory retrieval procedure exists.

Fresh seeds use one workspace with optional strategy briefs. Existing Basic
Memory notes and user-edited seeds require the explicit preserved
[transition](../../docs/update-and-customization.md#workspace-transition).
