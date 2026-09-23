# 0037: Shared development provider defaults and native credential pools

## Context

Development profiles inherited `model.provider` and `model.default` from the
shared Hermes root, but a named custom provider also needs its `providers`
definition. A newly initialized worktree could therefore name a provider it
could not resolve. Root `.env` credentials are not inherited by fresh named
profiles. This is separate from service readiness: a user may start Desk before
configuring credentials or switch credentials later.

## Ruling

Keep one central native configuration and authentication owner at Pythia's
Hermes root. Development preparation copies the selected `custom:<key>`
provider's simple, non-secret native routing definition when that key is absent
from the profile. It uses native `config get/set`, not a YAML merge or another
provider registry. Empty profiles still inherit model defaults; existing model
choices and provider definitions, including disabled or partial definitions,
remain untouched. This also repairs a missing route for an existing selected
custom provider on its next preparation.

Supported defaults are modern `providers` mappings with a simple alphanumeric,
underscore or hyphen key and native endpoint, name, transport/API mode,
default-model, enablement and environment-key-name fields. The endpoint must be
HTTP(S) without credentials, query or fragment. Every supplied endpoint alias
(`api`, `url`, `base_url`) must pass this check and resolve to the same URL. Secret values, header maps,
credential commands, legacy provider lists and other complex definitions remain
explicit native profile setup. Preparation never copies `.env`, authenticates,
probes a provider or gates stack readiness on credentials. Native configuration
write/readback errors remain preparation errors.

Credentials are added explicitly to the native root authentication pool using
`just auth <provider> api-key` (or the native supported OAuth flow). Hermes'
native per-provider root fallback serves profiles without an explicit local
pool. A profile pool shadows the root pool. Pythia neither copies credentials
into profiles nor adds a second credential store or environment fallback.
Existing profile credentials remain user-owned; this change does not migrate
or remove them automatically.

## Rationale

A named route must accompany the model choice that references it. Non-secret
configuration defaults can be copied during existing preparation while credential
custody remains native and central. Credential changes and account availability
are runtime concerns; startup checks must not force an account or block the Desk
settings surface needed to change one.

## Consequences

New worktrees using supported central routing and a native shared credential pool
need no per-worktree credential setup. An already selected route that is missing
can be filled without changing the model. Provider definitions are defaults
copied when absent, not a continuously synchronized central overlay: editing
central routing does not overwrite configured profiles. Native shared pool
changes remain available through native fallback; explicit profile credentials
continue to take precedence. Unsupported routing or absent credentials can still
produce a use-time provider error, and do not become readiness failures.

## Rejected alternatives

Copying the root `.env` would duplicate secrets and freeze their values per
worktree. Inheriting every root setting would override profile isolation.
Automatically rewriting configured routes would discard user choices.
Authenticating or probing providers during readiness would prevent valid
unconfigured use and credential switching. Modifying Hermes' config loader or
adding a Pythia credential resolver would duplicate native ownership.

## Evidence

Pinned Hermes `agent/credential_pool.py`, `hermes_cli/runtime_provider.py` and
`hermes_cli/auth.py::read_credential_pool` define custom pool routing and
per-provider root fallback. `test/integration/provider-defaults.test.ts` covers
inheritance, missing-route repair, secret exclusions and preserved overrides.
`tooling/qualification/shared-provider-native.py` uses two disposable profiles
and synthetic credentials to qualify real native routing, shared fallback,
root credential changes and a local override without inference or listeners.
