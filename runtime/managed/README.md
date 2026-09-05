# Managed runtime

This directory is Pythia-owned source updated with each release:

- `runtime/managed/plugin/__init__.py` is the authoritative release-owned
  source for the small always-on operating context registered by the Pythia
  plugin.
- `skills/` is loaded directly by Hermes through `skills.external_dirs`; native
  bundle references, scripts, templates, and assets remain beside `SKILL.md`.
- `plugin/` is copied, never linked, into the selected Hermes profile.
- `runner/` contains the bounded SEC and EODHD adapters.
- `basic-memory/` is the native Hermes MCP entry for the separately supervised
  Basic Memory process.
- `python/` pins the unmodified Python runtime dependencies.

The profile, credentials, sessions, knowledge, caches, settings, and capability
choices live outside this checkout. Editing managed source creates a local fork:
an agent must explain the exact edit and its update consequences, then receive
explicit approval before changing it. This is advisory, not an access-control
boundary.

`runtime/seeds/profile/SOUL.md` is a create-once starting point, not a second
release-owned prompt authority. After initialization, the installed SOUL is
user-owned and updates preserve it.
