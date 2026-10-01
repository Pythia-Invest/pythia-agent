# Managed runtime

This directory is Pythia-owned source updated with each release:

- `runtime/managed/core/operating.py` is the authoritative release-owned
  source for the small always-on operating context registered by the Pythia
  core adapter.
- `skills/` is loaded directly by Hermes through `skills.external_dirs`; native
  bundle references, scripts, templates, and assets remain beside `SKILL.md`.
- `core/` contains Pythia's host support, including Desk context, shared
  protected transport, the identity backbone contracts (`core/identity/`,
  ADR 0037/0038) and the connector toolkit and wire contract that plugins reach
  through `pythia_platform` (`core/platform/`, ADR 0045). It is copied into the
  selected Hermes profile using the native extension mechanism under its
  existing `pythia` identity.
- `plugins/` holds the optional features, one native package each
  ([plugin authoring](../../docs/architecture/plugins.md)). `plugins/market-data/`
  is the coordinating feature: it routes a subject's read through core's price
  sources, provides the protected resident HTTP/SSE delivery and the instrument
  widgets, and bundles the financial skill. Every other directory is a connector
  or catalogue plugin for one source, and depends on core alone. The release list
  in `scripts/dev/managed-plugins.mjs` names what ships and which are on by
  default; [market data](../../docs/architecture/market-data.md) describes the
  connectors.
- `runner/` contains shared provider execution helpers, the connector workers
  that payloads declare, and the narrow native read-only session-context
  helper. The latter runs with the pinned Hermes environment.

Hermes preparation metadata lives in `runtime/hermes/`, outside these managed
feature payloads. Core lifecycle probes use Hermes's prepared interpreter in
bounded subprocesses. There is no separate core scripting environment; a future
research plugin owns its own libraries and setup. Historical Python environments
remain untouched; existing Basic Memory transitions may still use them.

The profile, credentials, sessions, knowledge, caches, settings, and capability
choices live outside this checkout. Editing managed source creates a local fork:
an agent must explain the exact edit and its update consequences, then receive
explicit approval before changing it. This is advisory, not an access-control
boundary.

`runtime/seeds/profile/SOUL.md` is a create-once starting point, not a second
release-owned prompt authority. After initialization, the installed SOUL is
user-owned and updates preserve it.

Core's `desk_view.py` exposes bounded recent structured Desk context through
`pythia_desk_view`; the fresh API-server toolset is `pythia-desk`. Native tool
settings and native deferred tool discovery remain authoritative. The operating
section `[PYTHIA_WORKSPACE_GUIDANCE_V1]` explains native memory, files, sessions
and skills, and asks for web citations as Markdown links right after the claim
they support, which Desk renders as source pills; `investment-memory` carries research discipline using native files, and core's
`pythia:identity-data` tells the agent how to read the identity stores read-only.
No new index, memory-provider integration or mandatory retrieval procedure exists.

Fresh seeds use one workspace with optional strategy briefs. Existing Basic
Memory notes and user-edited seeds require the explicit preserved
[transition](../../docs/update-and-customization.md#workspace-transition).

Legacy core SEC/EODHD tools and their dedicated workers, skills and dependencies
are retired. Connector packages own replacement capabilities through their own
native toolsets.
See [ADR 0034](../../docs/decisions/0034-core-and-optional-features.md).
