# 0034: Separate Pythia core from optional features

## Context

The singular `runtime/managed/plugin/` directory contains Pythia's core Hermes
adapter, while `plugins/` contains feature packages. The names obscure ownership.
The core also still registers the original SEC and EODHD tools, with dedicated
skills, workers, dependencies and settings controls. Those provider capabilities
belong in their own integrations rather than in the platform host.

## Ruling

Pythia-owned host support lives in `runtime/managed/core/`. Optional financial,
provider and other feature packages live in `runtime/managed/plugins/`. Core owns
Desk context, baseline operating guidance and shared protected transport; features
own their domain functionality and feature-specific skills.

Core continues to use the exact unmodified Hermes native extension mechanism.
Its installed native identity remains `pythia`, with the existing profile-local
destination and state. This is the adapter by which Pythia supplies its core to
Hermes, not another optional investment feature or an alternative plugin system.
Native access checks and existing enablement choices remain authoritative.

Remove the legacy core SEC/EODHD tools, their standalone skills, dedicated
workers, provider dependencies and settings controls. Later connector PRs must
provide and qualify their respective capabilities explicitly. No placeholder
operation, silent forwarding or replacement provider is installed here. Saved
credentials, settings, research and native user choices remain untouched.

Retain the shared connector execution helpers and the native session-context
helper. They have current consumers and do not grant arbitrary code execution.
The existing managed Python environment remains a minimal lifecycle dependency;
this change does not redesign its ownership or the legacy workspace transition.

## Consequences

Core support is recognizable in source and has no SEC/EODHD tool surface.
Financial foundations remain a feature package with no concrete provider in this
increment. Existing consumers of the retired tools lose those operations until
their respective integrations are installed; this is an intentional removal.
Historical provider contracts remain reference evidence, not current availability.

Keep this cleanup separate from financial implementation, Python quality tooling
and optional research execution environments. A future research-environment
feature may supply libraries and guidance through native Hermes execution, but
that proposal does not add an execution service or alter this PR's behavior.

## Rejected alternatives

Keeping provider tools in core would make an optional data subscription part of
the platform boundary. Adding stub connectors would disguise missing support.
Changing Hermes or adding a separate loader to avoid its native plugin mechanism
would duplicate runtime ownership. Renaming installed identities or deleting
saved provider values is unnecessary for clarifying source ownership.
