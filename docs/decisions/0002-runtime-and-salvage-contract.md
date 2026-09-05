# 0002: Runtime and salvage contract

Pythia pins exact, inspected dependencies and consumes only the operations in
`runtime/contracts/`. `runtime/versions.json` is the machine-readable identity
and artifact record.

Hermes Agent is an exact, unmodified, Pythia-owned dependency behind a narrow
profile/CLI/API seam. Managed skills use `skills.external_dirs`; one copied
profile-local plugin supplies the smallest prompt/tool integration. Native
Hermes configuration remains the only capability state. Basic Memory is an
exact, unmodified, separately supervised loopback process: Markdown is
authority, indexes are derived, updater/promotional behavior is off, and its
supported semantic-search switch is off so the first slice cannot download a
model.

The first financial slice includes both a bounded EdgarTools filing/facts read
and one EODHD end-of-day market read. They are optional at startup, keep
sibling success/failure explicit, and use only synthetic schema-derived test
fixtures unless publication rights are proven. Secrets and settings follow the
single-store/single-writer table in `docs/architecture/credential-custody.md`.

Stable releases use exact SemVer annotated Git tags with SSH signatures
verified by the currently installed trust root before candidate code executes.
First installation remains honestly trust-on-first-use unless the signer
fingerprint is obtained independently. `main` is explicit preview only.

Salvage is per-file and selective. Useful UI, interaction, runner, investment,
and memory behavior may be adapted after provenance and source review. Private
history, generated/device state, personal knowledge, credentials, monitoring,
fleet/cloud code, Hermes patches, unnecessary dependencies, and provider data
without publication rights are rejected.

Desk exposes two separate native Hermes surfaces: globally enabled/disabled
skills through `skills.disabled` and `api_server` toolsets through the native
platform-scoped tool commands. It does not derive a combined capability state,
compute per-platform skill state, warn about mismatches, repair settings, or
touch another platform. Tool-dependent managed skills may declare Hermes's
standard `metadata.hermes.requires_toolsets`; Hermes alone filters the generated
prompt against the session's available toolsets.

Hermes 0.21.0's authenticated skill-list endpoint does not carry platform
context and therefore lists a skill disabled only for `api_server`. Pythia
preserves that factual upstream limitation by not offering per-platform skill
toggles. Global skill readback and native `api_server` toolset readback remain
independent and fully qualified without patching Hermes or storing duplicate
state.
