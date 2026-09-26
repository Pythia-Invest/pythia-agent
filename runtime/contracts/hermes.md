# Hermes contract

## Qualified market-data extension seams

The core platform support uses native `ctx.register_platform_handler("api_server", factory)`.
At the exact pin below, `BasePlatformAdapter._wire_plugin_handlers` passes the
existing application and adapter; `APIServerAdapter.connect` invokes factories
before route freeze. Registration alone does not authenticate routes. The shared
adapter invokes `_expected_api_key` and `_check_auth`, fails closed on missing
keys, binds trusted native platform/profile context and rejects another effective
home. No Hermes source is modified.

The financial tool holds a lazy profile backend. Protected HTTP dispatches that
registered handler, sharing memory with agent calls. CLI shares implementation and
durable state only. A bounded executor isolates blocking work from native chat and
the event loop; cleanup cancels work and reaps owned children. Deliberately exposed
specialist operations use the same adapter, never arbitrary native-tool dispatch.

Contribution metadata uses the native tool parameter schema's standard `$comment`
annotation. Projection reads Hermes registry schemas; native plugin, platform,
disabled-toolset and readiness checks remain authoritative before reuse/publication.
There is no additional capability inventory. The pinned native manager's loaded
plugin module namespace supplies dependency helpers; connectors must require the
native feature rather than invent import aliases or source loaders.

Access also projects the pinned manager's active `_registration_order` handles
to determine actual tool ownership. Manifest `provides_tools` and a specialist
annotation are descriptions, not authority. Native category keys and legacy bare
names are accepted with `plugins.disabled` taking precedence over `enabled`.
Every shared contribution target must have an active native owner; specialist
annotations must identify their actual owner. Post-execution checks deny result
publication after access changes, including uncached shared calls and CLI reads.

The protected address is `/v1/pythia/plugins/{plugin-id}/{operation}`. Market data
declares `pythia-market-data/query` through the same mechanism as other features;
the generic adapter does not depend on financial enablement. The native loaded
core module supplies reusable transport helpers, with no separate operation
inventory. The shared updates channel includes plugin and operation in each resource.

Native `ctx.register_skill(name, path, description=...)` attaches a bundled
skill to its plugin registration. The pinned runtime exposes its qualified name
through `skills_list` and `skill_view`; these registered skills are not added to
the automatic prompt skill index. Feature tools point to relevant bundled
guidance. Disabling the plugin removes that native registration on restart.

`scripts/dev/managed-plugins.mjs` explicitly copies core and feature files. Fresh
profiles enable the declared default set through native commands; updates preserve
existing choices and content-qualified user replacements.
The copied-feature probe `tooling/qualification/financial_http.mjs` exercises the
real API application, synthetic native tools, shared lifetime, authentication,
profile/access revocation, preferred/pinned reads, cancellation and responsiveness.
It starts no model/CLI subprocess during requests and uses disposable state only.
See [ADR 0029](../../docs/decisions/0029-financial-http-and-runtime-lifetime.md).

## Pinned installation

This contract covers only Hermes Agent 0.21.0 at commit
`29112bef099274229cadff79cdff7bf7b99c4b77` (release
`v2026.8.31`). Pythia installs that source unmodified in its own environment.
It is replaceable and is never a global prerequisite, patch series, vendored
tree, or independently updated component.

The locked source environment is hydrated with the upstream curated dependency
set:

```text
uv sync --frozen --extra all
```

The narrower `--extra mcp` set is not an API-server installation: it omits
`aiohttp`, so Hermes reports that the API Server has no adapter. Pythia does not
repair that with an ad hoc `aiohttp` install, a custom combination of extras,
`--all-extras`, or a source patch. Installing the curated `all` dependencies only makes the
released adapters available; it does not enable unwanted toolsets or messaging
platforms. Native profile configuration remains the sole enablement authority.
See the tagged upstream
[installer](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/scripts/install.sh) and
[curated extras](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/pyproject.toml).

`runtime/versions.json` is the single pin record. The install-facing
`runtime/hermes/hermes-source.json` repeats its release, commit and
archive beside the hydration command; `just check` fails when they disagree.
Code derives the installed source directory and expected health version from
the record; prose that names the version is found by searching for it.

## Process, environment and health

Both the development supervisor and the installed user unit start
`hermes -p <profile> gateway run --external-supervisor`, so an upstream update
restart exits back to Pythia's owner instead of launching Hermes's detached
watcher. The process environment sets `HERMES_HOME`,
`HERMES_DISABLE_LAZY_INSTALLS=1` and `API_SERVER_HOST`/`PORT`/`KEY`. The API
server platform is enabled by the presence of a usable `API_SERVER_KEY` (at
least 16 characters, `gateway/config.py:_apply_env_overrides`); there is no
separate enable flag. Plugin handlers run in the Hermes process and read
Pythia's own `PYTHIA_*` variables from that same environment.

Readiness is unauthenticated `GET /health`, which returns
`{"status":"ok","platform":"hermes-agent","version":<hermes_cli.__version__>}`.
The development supervisor and installed readiness accept only the pinned
`package_version`, so a stale or foreign gateway on the port is not mistaken
for Pythia's Hermes. A profile's session database is
`$HERMES_HOME/state.db` for `default` and
`$HERMES_HOME/profiles/<profile>/state.db` otherwise; only the allowlisted
read-only runner below opens it.

## Profile and credential owner

The sole bootstrap exception for a missing profile is exactly:

```text
HERMES_HOME=<Pythia Hermes root> hermes profile create <lowercase stack profile> --no-alias --no-skills
```

Hermes validates global `-p` before dispatching the `profile create` subcommand
and rejects a name that does not yet exist, so bootstrap must not supply `-p`.
After creation, every profile-scoped invocation supplies both
`HERMES_HOME=<Pythia Hermes root>` and
`hermes -p <lowercase stack profile> …`. A named profile lives below
`$HERMES_HOME/profiles/<profile>` and isolates configuration, sessions, memory,
skills, workspace, and state. The credential owner is the root
`$HERMES_HOME/auth.json`: a named profile reads it as a fallback, while a
profile provider/pool entry shadows the root entry. OAuth refresh of a
root-sourced record writes through to the root owner under Hermes's
cross-process `auth.lock`. Native saves use a private temporary file and
`os.replace`; credential directories are mode `0700` and files `0600`.

The lifecycle creates this isolated profile once. It never adopts an ambient
profile or unrelated Hermes installation.

The fresh Pythia profile seed sets native `auxiliary.free_only: true`. In this
release, that setting skips an auxiliary OpenRouter fallback before client
construction whenever its resolved model is not a free SKU; Pythia does not
select or proxy an auxiliary model itself. The seed is create-if-absent, so a
later user change remains profile-owned and is never reconciled by Pythia. See
the tagged [auxiliary defaults](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/config_defaults.py) and
[free-only gate tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/agent/test_auxiliary_client.py).

Only the root-scoped native flows
`hermes -p default auth add --type oauth <provider>` (or `--type api-key`),
`hermes -p default auth status <provider>`, and native root-scoped logout may
create, read readiness for, or remove model credentials. Explicit `-p default`
prevents the sticky active-profile setting from redirecting these commands.
API keys use Hermes's masked interactive prompt and native credential pool.
Pythia does not use the
deprecated `login` alias, the `--api-key` argument, or parse, copy, symlink, or
display credential values. See the tagged
[profile implementation](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/profiles.py),
[authentication commands](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/auth_commands.py),
and [credential persistence](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/credential_persistence.py).

`auth status` is a provider-specific, root-owned observation. A successful
command can report that one named provider is logged out; it does not prove
that another provider is unusable or that Hermes lacks a usable model route.
Pythia may label the named result, but does not aggregate provider readiness or
turn a Codex result into general model-account readiness. Status must never
bootstrap a profile, hydrate dependencies, build source, change configuration,
or create/copy an auth store.

Authentication and model selection are distinct. An authenticated root account
does not populate a named profile's `model` selection. Development uses native
`hermes -p default model` for shared selection and native profile `config
get model` / `config set model.<field>` for empty-profile inheritance. The bare
`config set model '<JSON>'` form stores a string in this release, not a mapping;
use dotted setters and verify the resulting object. Only `provider`, `default`,
`base_url`, and `api_mode` strings are eligible; existing partial configuration
is user-owned. Native custom-provider definitions outside those fields remain
profile-local. See [development](../../docs/development.md) for apply semantics.

Run and request failures retain the error message Hermes supplies. Desk does
not classify provider failures or substitute onboarding guidance. The local
Hermes API bearer remains server-only and is mechanically redacted if Hermes
ever echoes that exact value in an error response.

## Workspace cwd and context

For a fresh Pythia profile, the lifecycle sets and reads back the resolved
absolute workspace with the native profile command:

```text
hermes -p <profile> config set terminal.cwd <absolute-workspace>
hermes -p <profile> config get terminal.cwd --json
```

This happens inside the first profile-initialization transaction. A later
native user choice is profile-owned and is never reset during startup, refresh,
rebuild, or update. An older profile that lacks the value is diagnosed and
repaired only through the same explicit native command; it is not silently
migrated.

The value is not equivalent to the service process directory. The gateway
bridges an explicit `terminal.cwd` to `TERMINAL_CWD`; local unset or placeholder
values (`.`, `auto`, `cwd`) instead resolve to `MESSAGING_CWD` and then the
OS user's home (`Path.home()`). `resolve_agent_cwd()` supplies the terminal/environment view and
`resolve_context_cwd()` supplies project-context discovery. Consequently,
starting the gateway with `WorkingDirectory=<workspace>` is insufficient when
the profile setting is absent. Pythia uses the explicit absolute setting so
the native terminal and `AGENTS.md` context both resolve to the user workspace,
even when the Hermes process starts elsewhere.

The workspace `AGENTS.md` is seed-once, user-owned runtime context. It is
distinct from the repository's builder `AGENTS.md`, which is never an
automatic runtime input. Exact behavior is in the tagged
[configuration bridge](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/run.py),
[placeholder resolver](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/cwd_placeholder.py),
[agent cwd resolver](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/runtime_cwd.py),
[context loader](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/prompt_builder.py),
and [terminal implementation](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tools/terminal_tool.py).

## Skills, tools, and plugin

`skills.external_dirs` contains the absolute managed-skills directory. Hermes
also accepts paths relative to the active profile, ignores missing or duplicate
directories, and resolves the first skill of a name. Its order is trusted
project skill, profile-local skill, then external managed skill. Production
must keep the selected workspace outside development-only source; project and
profile-local skills remain the supported same-name overrides.

A directory skill is a native bundle, not a single-file artifact. `SKILL.md`
is its entry point; `skill_view(<skill>, file_path=<relative-path>)` can read a
regular supporting file beneath the selected skill root, including files in
`references/`, `templates/`, `assets/`, and `scripts/`. The main view reports
those linked categories. Native resolution rejects absolute names, `..`
traversal, and links that escape the bundle. Pythia therefore preserves these
supporting files in managed skills and does not build its own discovery index
or flatten a bundle to `SKILL.md`. See the tagged
[skill tool](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tools/skills_tool.py) and
[path-boundary tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/tools/test_skill_view_traversal.py).

Hermes runtime discovery can union `skills.disabled` with
`skills.platform_disabled.<platform>`, and the built-in `hermes-agent` skill is
essential and cannot be disabled. Pythia exposes only the global skill control
because that is the native state authenticated `GET /v1/skills` can read back.
There is no dedicated non-interactive skill enable/disable command in this
release. The qualified Pythia skill mutation is only:

```text
hermes -p <profile> config get skills.disabled --json
hermes -p <profile> config set skills.disabled '<JSON array>'
```

`config set` parses JSON/YAML structured values, preserves sibling keys, and
atomically replaces the configuration file. The Pythia caller must hold its
single capability-mutation lock around read/validate/modify/write, reject an
unknown skill name, restart Hermes, and then authenticate its API readback.
It never edits Hermes YAML itself. The generic command currently prints an
"unrecognized config key" warning for `skills.disabled` even though the tagged
skill loader consumes it; callers treat only exit status plus exact config and
API readback as success, never the warning text. Exact behavior is in
[commands.py](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/commands.py),
[skills_config.py](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/skills_config.py), and
[skill discovery tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/agent/test_external_skills.py).

Toolset state has a dedicated platform command:

```text
hermes -p <profile> tools list --platform api_server
hermes -p <profile> tools enable <toolset> --platform api_server
hermes -p <profile> tools disable <toolset> --platform api_server
```

The fresh profile seed explicitly configures identical `cli`, `cron`, and
`api_server` toolset lists: `cronjob`, `delegation`, `file`, `memory`,
`session_search`, `skills`, `terminal`, `todo`, `vision`, and `web`. This
replaces each platform's broad implicit Hermes default and intentionally omits
`computer_use`, the retired lab-only `kanban`, and every other unselected
toolset. Pythia's plugin toolsets remain native plugin state rather than entries
in this base list. Because the profile seed is create-if-absent, later native
tool changes and direct user edits are preserved rather than reconciled.

These commands preserve other platforms' state. Restart Hermes and require the
named entry in authenticated `GET /v1/toolsets` to carry the requested
`enabled` value before reporting success.

Desk presents global skill controls and `api_server` toolset controls as two
independent native surfaces. It does not derive a combined capability state,
compute platform-specific skill state, compare or warn about mismatches,
auto-repair configuration, or read/write another platform.

A managed skill that depends on tools may use standard frontmatter:

```yaml
metadata:
  hermes:
    requires_toolsets: [<toolset-name>]
```

Hermes extracts the list and, during normal agent prompt construction, includes
the skill in the generated skill index only when every required toolset is
represented by the agent's valid tools. If filtering information is absent the
helper fails open for backward compatibility. This is prompt relevance, not a
skill enablement or security boundary: explicit skill access remains native,
and `/v1/skills` does not become a combined skill/toolset view. Pythia neither
reimplements this filter nor stores its result. See the tagged
[condition extractor](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/skill_utils.py),
[prompt filter](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/prompt_builder.py),
[agent prompt construction](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/system_prompt.py), and
[filter tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/agent/test_prompt_builder.py).

Pythia copies the core plugin and platform support into `<profile>/plugins/pythia/`
and the financial feature into `<profile>/plugins/pythia-market-data/`.
Explicit allowlists include only runtime inputs, never builder guidance.
Plugins are never symlinked or installed as Python packages. Their native
manifests declare provided tools. Before activation, copied directories pass:

```text
hermes -p <profile> plugins doctor <copied-plugin-directory> --ci
hermes -p <profile> plugins enable pythia --no-allow-tool-override
```

`doctor --ci` uses the production manifest/import/register path and exits
nonzero on a diagnostic error, but is validation rather than a security
sandbox. The plugin exposes `register(ctx)`. Qualified surfaces used here include:

- `ctx.register_system_prompt_section(id, content, position="after_memory",
  max_chars=<at most 4000>)`; Hermes caps the combined registered prompt at
  8,000 characters and 32 sections. It is frozen when a new session is built.
- `ctx.register_tool(name, toolset, schema, handler, check_fn=None,
  requires_env=None, is_async=False, description=None, emoji=None,
  override=False)`. Pythia never overrides a built-in name or capability.
  Handlers return a JSON-serializable value or string and convert bounded
  provider failures to the Pythia result shape.
- `ctx.register_skill(name, path, description="", frontmatter=None)` for bundled,
  explicitly discoverable feature guidance.
- `ctx.register_platform_handler("api_server", factory)` for the shared platform
  adapter on the existing HTTP application, never a new listener.

Plugin/configuration changes take effect for a new process and new session;
the lifecycle owner restarts Hermes. Evidence is the released
[plugin loader](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/plugins.py),
[plugin doctor](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/hermes_cli/plugin_dev.py), and
[prompt-section tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/agent/test_plugin_prompt_sections.py).

### Upstream per-platform skill-list limitation

Hermes 0.21.0 can store and apply `skills.platform_disabled.<platform>` when a
runtime session supplies platform context. Its authenticated `GET /v1/skills`
handler enumerates without that context, however, so a skill disabled only for
`api_server` still appears in the endpoint. This observed upstream limitation
is why Pythia does not expose or mutate per-platform skill controls. It does not
affect global skill controls or native platform-scoped toolset controls. See
[API skill listing](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server.py) and
[platform-disabled runtime tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/gateway/test_stacked_skill_platform_disabled.py).

## Authenticated read API

Hermes must start with a server-side `API_SERVER_KEY` of at least 16
characters. Desk's server supplies `Authorization: Bearer <key>`; browser code
never receives it. Missing or wrong credentials return HTTP 401:

```json
{"error":{"message":"Invalid gateway API key (API_SERVER_KEY)","type":"gateway_auth_error","code":"gateway_auth_failed"}}
```

Other API errors use `{"error":{"message","type","param":null,"code"}}`.
Pythia consumes only:

- `GET /v1/skills`: `object`, and `data[].{name,description,category}`.
- `GET /v1/toolsets`: `object`, `platform`, and
  `data[].{name,label,description,enabled,configured,tools[]}`.

Absent optional fields stay absent/null; no full upstream DTO is copied.

## Chat model selection

`GET /api/model/options` is the native picker catalog, unlike `/v1/models`
which primarily advertises virtual routes. Desk consumes only root `provider`
and `model`; provider `slug`, `name`, `authenticated`, `auth_type`, `source`,
`warning`, `aliases`, `featured_models`, and `unavailable_models`; model IDs; sanitized
`pricing[model].{input,output,free}`; and the native
`capabilities[model].reasoning` / `can_disable_reasoning` flags. It never forwards
endpoints, keys, credential values, credential environment names, or arbitrary
inventory fields to the browser.
Native inventory discovery may contact model catalogs; it does not run inference.
The user-triggered refresh passes `refresh=true` to this endpoint so Hermes
busts its per-provider model cache and probes configured custom providers.
Ordinary catalog reads omit the flag and retain Hermes's cached behavior.

In this release, the API-server handler does not accept the Desktop catalog's
`explicit_only` option. The normalized inventory consequently publishes the
built-in Mixture-of-Agents `default` preset as an authenticated virtual provider
even when the profile contains no explicit `moa` configuration, and this API
server does not expose the dashboard's `/api/model/moa` read/write surface.
Desk excludes that virtual provider from user-facing model discovery. It keeps
the qualified provider/model request fields intact so an existing stored MoA
selection remains pass-through rather than being silently rewritten.

`POST /v1/runs` accepts explicit `provider`, `model`, and
`model_options.reasoning_effort` for that request. Desk forwards only those
validated selection fields, not arbitrary options, URLs, keys or commands.
The native effort ladder is `none`, `minimal`, `low`, `medium`, `high`, `xhigh`,
`max`, `ultra`; transport-specific clamping remains Hermes-owned. An omitted
selection uses native defaults. Native session-route locks still apply.
The pinned `_create_agent` resolves the global runtime before applying request
overrides: an empty profile can therefore fail with `No inference provider
configured` even with an authenticated per-request selection. On the first
explicit send only, Desk initializes an empty profile using native dotted
provider/model setters, verifies their readback, and restarts Hermes before
starting the run. It checks the native authenticated catalog first and never
overwrites an existing or partial selection. Shared root defaults and
credentials remain untouched. Later requests use ordinary native overrides.
Evidence: the pinned `api_server.py` handlers `_handle_model_options`,
`_request_agent_overrides`, `_request_reasoning_config`, and the run handler in
`api_server_runs.py`; catalog shape is owned by `hermes_cli/inventory.py`.

## Sessions

The bounded session surface is:

- `GET /api/sessions?limit=<n>&offset=<n>&include_children=false`; consume
  `data[].{id,title,last_active,preview,message_count,ended_at}`.
- `POST /api/sessions` with `{"title":"…"}`; consume the HTTP 201 session.
  Suggested titles must be unique. Native `invalid_title` (HTTP 400) rolls back
  the new row; Desk may retry that specific rejection once with `{}` to let
  Hermes create an untitled session. It never retries ambiguous failures or
  changes an existing session to make a suggested title available.
- `PATCH /api/sessions/{id}` with `{"title":"…"}`. Unknown fields return 400
  `unsupported_session_field`; an invalid title returns 400 `invalid_title`.
- `GET /api/sessions/{id}/messages?limit=<n>&offset=<n>`; the native maximum is
  500. Consume `data[].{id,role,content,timestamp,tool_call_id,tool_name,
  tool_calls,finish_reason,reasoning,reasoning_content,display_kind}` plus pagination.
  Tool-related and reasoning fields are optional; `timestamp` is epoch seconds.

There is no separate session-resume endpoint. Supplying an existing
`session_id` to a new run reloads its transcript. See
[session API tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/gateway/test_session_api.py).

## Runs, stream, approvals, and stop

Create with `POST /v1/runs` and a bounded body
`{"input":"…","session_id":"…"}`. Hermes returns HTTP 202 with `run_id`,
`status`, and `replayed`; callers may use its idempotency header. Read status at
`GET /v1/runs/{run_id}` and stream `GET /v1/runs/{run_id}/events`. Status may
contain `object`, `run_id`, `status`, `created_at`, `updated_at`, `session_id`,
`model`, and optional `approval`, `output`, `usage`, `error`, `pending_steer`,
or `last_event`.

The event endpoint consumes one `asyncio.Queue` per run. It does not replay or
broadcast: simultaneous subscribers compete for queued events. A subscriber's
exit removes the queue, so later event requests may return 404 even while the
run is active or its terminal status is still readable. Consumers must use
native status to recover terminal output or pending approvals, rather than
interpret a missing stream as run failure.

The SSE stream contains comment keepalives and `data:` JSON frames. Consumers
switch on `event` and ignore unknown fields/types. Qualified events are:

- `message.delta`: `run_id`, `timestamp`, `delta`;
- `tool.started`: `run_id`, `timestamp`, `tool`, nullable `preview`;
- `tool.completed`: `run_id`, `timestamp`, `tool`, `duration`, `error`;
- `reasoning.available`: `run_id`, `timestamp`, `text`;
- `subagent.start` / `subagent.complete`: optional `preview`, `goal`, task and
  agent identifiers/counts, parent/depth/model/tool/status/summary/duration,
  token/API/cost counts, file lists, and `output_tail`;
- `approval.request`: `run_id`, `timestamp`, redacted `command`, `description`,
  `pattern_key` or `pattern_keys`, `request_id`, `smart_denied`,
  `allow_session`, `allow_permanent`, and `choices` where present;
- `approval.responded`: `run_id`, `timestamp`, `choice`, and optional
  `request_id`;
- `run.steered`; and terminal `run.completed` (`output`, `usage`, optional
  `pending_steer`), `run.failed` (`error`), or `run.cancelled`.

`subagent.tool`, `subagent_progress`, and internal thinking events are not on
this stream. The native agent callback's `moa.progress`, `moa.phase`,
`moa.reference`, and `moa.aggregating` events are also not forwarded by this
run adapter. Optional values are not synthesized.

The name `reasoning.available` does not identify a provider reasoning stream:
`agent/conversation_loop.py` sends `assistant_message.content`, strips selected
reasoning XML tags and truncates to 500 characters. It includes final answers.
Desk treats an unstreamed interim value as a commentary preview, never as proof
of private reasoning. Separate reasoning fields may be available in history.
The run handler does not wire the agent's `reasoning_callback` into this SSE
surface. See the pinned
[content callback](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/agent/conversation_loop.py).

Live tool events omit call IDs, full arguments and result bodies. Overlapping
same-name calls cannot be correlated safely from these events alone. Native
history provides the IDs and bodies; insertion timestamps are not execution
timers. `run.completed.output` is the final answer even if earlier text was
streamed. Unlike the separate `/api/sessions/{id}/chat/stream` API, this
`/v1/runs` terminal event does not carry the full turn transcript, so completed
history enrichment uses `GET /api/sessions/{id}/messages`.

Respond at `POST /v1/runs/{run_id}/approval` with
`{"choice":"once|session|always|deny","request_id":"…"}`; bulk-resolution
fields are outside the first slice. `deny` is rejection. The response unblocks
the same run; there is no resume request. Invalid choice/request is HTTP 400;
no active matching approval is 409. `/v1/runs` raises approval events only
because `gateway run` sets `HERMES_EXEC_ASK=1`; without it the API server
denies dangerous commands outright. The pinned default `approvals.mode` is
`smart`, which asks an auxiliary model before the user, and the Pythia seed
does not override it. Stop is
`POST /v1/runs/{run_id}/stop`. It is idempotent for a terminal run; an active
run first becomes stopping, receives a hard interrupt, and becomes cancelled
only when the agent exits and emits `run.cancelled`. There is no `/cancel`
route. A disconnect from SSE does not stop the run; Desk explicitly invokes
stop when its admitted cancellation policy requires it, then follows status to
a terminal state.

Steer an exactly `running` run at `POST /v1/runs/{run_id}/steer` with a
non-empty `input`, `message`, or `text` field. A successful response contains
`accepted: true` and the stream emits `run.steered`; that event does not repeat
the submitted text. A run that is stopping or otherwise not accepting steer
returns HTTP 409. Guidance accepted after the final tool boundary may instead
return as `pending_steer` on terminal status/event for the client to replay as
the next turn. `GET /v1/capabilities` advertises this as `features.run_steer`
and advertises the model catalog as `features.model_options`.

The source of truth is
[api_server_runs.py](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/gateway/platforms/api_server_runs.py) and its
[run API tests](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/tests/gateway/test_api_server_runs.py).

## File and image input

The pinned `/v1/runs` handler accepts a string or a list of messages as `input`.
For a list, the last message's `content` becomes `run_conversation`'s
`user_message`, including structured text and `image_url` blocks. SessionDB
encodes and decodes structured content, and the session message endpoint retains
it in its projection. Desk sends locally uploaded images as base64 data URLs;
ordinary documents are referenced by local paths for Hermes's existing tools,
following the native gateway document-context convention.

The native API request cap is 10,000,000 bytes. Desk's combined image budget is
6 MiB to leave room for base64 expansion, prompt and metadata. This transport
does not imply universal vision or document-format support. The separate web
dashboard upload path and browser-control artifact endpoints are not general
Desk upload contracts. See [ADR 0010](../../docs/decisions/0010-local-chat-attachments.md).

## Workspace research and scoped context

[ADR 0013](../../docs/decisions/0013-workspace-and-native-research-context.md)
selects native file tools, memory, session recall and skills as the existing
storage/context owners. The managed `pythia.operating` section is registered
`after_memory`, with a 4,000-character cap and marker
`[PYTHIA_WORKSPACE_GUIDANCE_V1]`. Its source is `runtime/managed/core/operating.py`; registration
stays in `runtime/managed/core/__init__.py`. The managed `investment-memory` skill depends on
`file`, not an MCP research store. It is selected when useful, not on every turn.

Ordinary resume in `agent/conversation_loop.py::_restore_or_build_system_prompt`
restores the native stored full prompt. `agent/system_prompt.py` freezes plugin
sections during a prompt's life; native compaction invalidation re-renders them.
A source copy or process restart alone does not prove adoption by an existing
chat. Fresh native sessions are the dependable adoption boundary; legacy chats
remain available with a notice and selective-recall continuation reference.

Optional strategy notes use `[PYTHIA_WORKSPACE_SCOPE_V1]` with version 1,
`originSessionId` and `briefPath`. Briefs are ordinary
`strategies/<name>/README.md` files; no profile/session metadata or process cwd
mutation implements scope. The opening scope evidence remains unique. Later native user input carries
bounded provenance separately, without reproducing the searchable opening marker
or overriding current user directions.

Normal HTTP history omits compacted rows. The allowlisted
`runtime/managed/runner/native_session_context.py`, invoked in the pinned Hermes environment
against the configured profile only, calls native `SessionDB(read_only=True)`,
`get_session`, `get_compression_lineage`, `search_messages` and
`get_messages_around(..., window=0)`. Search is role-filtered and bounded;
projection fields are `id`, `session_id`, `role`, `snippet`. Snippets and summaries
never establish scope. Exact anchors must remain active or compacted, so a rewind
between search and anchor retrieval cannot restore withdrawn association.
Compression lineage includes descendants and needs explicit bounded validation;
it is not delegation/fork inheritance.

The helper checks native repair/stale status and the pinned private
`_fts_enabled` flag, because the read-only constructor does not establish search
completeness. NUL-prefixed native structured content can evade fallback search;
incomplete indexing returns unresolved rather than a guessed general scope.
Managed guidance status uses the native framed plugin-section parser, not a
substring found anywhere in the system prompt. These narrow private seams are
qualified against the exact pin and must be rechecked when it changes. The
result contains scope provenance, guidance status and a bounded first-input
eligibility snapshot, never raw messages,
system prompt or browser-selected database paths. No schema/index is copied.

## Current Desk view tool

The existing plugin's `desk_view.py` registers `pythia_desk_view` in native
`pythia-desk`. Its only model argument is `view_reference`; native dispatch
supplies `session_id`. The result is a JSON string with bounded structured view
context or an explicit unavailable reason. It reads Desk's transient private
cache, never opens a browser or an HTTP listener. The reference belongs to the
submitting browser/tab/native session and expires without current publication;
there is no unrelated session/tab fallback. Generic page title/route and
observable file context may be present; arbitrary settings values and DOM are not.

Fresh `api_server` defaults enable this toolset; existing native choices remain
unchanged. Hermes may defer plugin tools behind its native tool-search bridge,
so absence from the initial direct tool list alone does not mean unavailable.
Qualification checks the native enabled catalog and dispatch, not an invented
Pythia capability registry. Provider runners do not receive view-state paths.

`tooling/qualification/workspace-native.py`, `workspace-instructions.py` and the
native session-context fixture exercise these seams with disposable synthetic
state and no model inference. Structural delivery is not evidence of investor
judgment or live UI/remote behavior.

First-input eligibility is established from exact native absence of all retained message
rows plus eligible session metadata, not absence from the ordinary active-only
HTTP transcript. This is a bounded current-state snapshot, not proof that the
session never had historical data. It permits an initial scoped input without claiming that an
uncreated prompt contains current guidance. Guidance stays unavailable until
verified in the native framed section. Settings separately exposes the native
`terminal.cwd` and Desk workspace root as matched/different/unavailable, preserving
the user's cwd; canonical host references and browser root admission do not
change when those roots differ.

## Known defects at this pin

Recorded 2026-09-23. Recheck on every upgrade and remove resolved entries.

- **Mid-run steering is not saved.** `agent/tool_executor.py:_flush_session_db_after_tool_progress`
  saves each tool result immediately; `apply_pending_steer_to_tool_results` then
  appends the steer to that saved message in memory only, and later flushes skip
  saved rows. The model sees the steer for the rest of that run only; later runs
  rebuild history from `state.db` and probably do not. The steer disappears
  from Desk on reload. Upstream commit `7dc796463d` (2026-09-09, first released
  in v2026.9.11) saves a standalone `role: "user"`, `display_kind: "steer"` row.
  Resolved by upgrading the pin; a browser-side copy was rejected as a second
  transcript store.
- **Upgrade blocked: `GET /v1/skills` returns HTTP 500** in v2026.9.11 through
  v2026.9.21 and on `main` as of 2026-09-23. Commit `a6ee31f55a` made the
  handler call `_find_all_skills(skip_disabled=False, include_editorial=True)`;
  the same-day revert `0dcadf6f41` removed that parameter from
  `tools/skills_tool.py` but not the call, so it raises `TypeError`. Desk
  skill settings and the skill-toggle readback depend on this endpoint. Upstream
  issue NousResearch/hermes-agent#108967; fix PRs #108968 and #113058 are
  unmerged. Pythia stays on v2026.8.31 until the first release containing the
  fix, which also resolves the steering defect.

## Touchpoint index

Every place Pythia depends on Hermes behavior has one row here. An upgrade
walks this table against the new release; a change that adds or alters a
dependency updates its row and coverage in the same change
([rule](../../.agents/rules/hermes-touchpoints.md)). Locations name files, not
lines. Anchors name the file and symbol at the pin. Desk paths are relative to
`apps/desk/src/`.

Coverage terms: **probe** is `tooling/qualification/native_hermes_probe.py`
against the real pin; **assembled** is the assembled run of `just qualify`;
**manual** is a `tooling/qualification/workspace-*.py` script run by hand;
**wire capture** is the provider-free capture of pinned Hermes output
(`just capture-hermes`, checked by `just check-hermes-capture` in `just qualify`; [ADR 0020](../../docs/decisions/0020-hermes-wire-capture-goldens.md)); **fixture** is hand-written
test data, which guards Pythia behavior but cannot detect Hermes drift.

| Pythia location | Hermes anchor at the pin | If it changes | Coverage |
| --- | --- | --- | --- |
| **Install, process and environment** | | | |
| `runtime/versions.json`, `runtime/hermes/hermes-source.json`, `scripts/dev/runtime-source.mjs` | tag tarball; `pyproject.toml` `all` extra and `uv.lock` | Loud: hash, missing file or `uv sync` error | `test/integration/dev-managed-assets.test.ts`; pin agreement in `just check` |
| `scripts/dev/runtime-config.mjs`, `scripts/install/runtime-source.mjs`, `server/native-session-context.ts` | uv layout `.venv/bin/hermes` and `python` | Loud: missing executable | probe |
| `scripts/dev/hermes-pin.mjs`, `scripts/dev/supervisor-services.mjs`, `scripts/install/runtime-prepare.mjs` | `gateway/platforms/api_server.py:_handle_health` (`_hermes_version`) | Loud: never ready | `test/unit/hermes-pin.test.ts`; wire capture golden (not yet asserted) |
| `scripts/dev/runtime-config.mjs`, `scripts/install/systemd.mjs`, `packaging/systemd/pythia-agent-hermes.service.in` | `gateway run --external-supervisor`; `hermes_cli/gateway.py:_prepare_profile_gateway_update_restart` | Loud if removed; silent if restart ownership moves | assembled |
| `scripts/dev/environment.mjs`, `scripts/install/systemd.mjs`, `scripts/install/service-launch.py` | `API_SERVER_KEY`/`HOST`/`PORT` in `gateway/config.py:_apply_env_overrides`; `HERMES_DISABLE_LAZY_INSTALLS` in `tools/lazy_deps.py:_allow_lazy_installs` | Loud: no listener; silent: lazy installs change the locked environment | assembled (listener); none (lazy installs) |
| `runtime/managed/core/__init__.py` | plugin handlers run in the gateway process and inherit its `PYTHIA_*` environment | Silent: tools report unavailable | fixture `runtime/test/python/test_core.py`; assembled |
| `server/native-session-context.ts` | `hermes_state.py:DEFAULT_DB_PATH`; `profiles/<profile>/state.db` layout | Silent: context unavailable | manual `workspace-session-context.py` |
| **CLI and configuration** | | | |
| `scripts/dev/runtime-config.mjs`, `scripts/dev/runtime-prepare.mjs` | `profile create --no-alias --no-skills`; `.no-bundled-skills` marker (`hermes_cli/skills_hub.py`) | Loud | probe |
| `scripts/dev/runtime-config.mjs`, `server/device-settings.ts`, `server/model-initialization.ts`, `scripts/update/workspace-transition-state.mjs` | `config get <key> --json`, `config set` (`hermes_cli/config.py:get_config_value`, `set_config_value`) | Mostly loud through readback | probe (`terminal.cwd`, `skills.external_dirs`); fixture for other keys |
| `scripts/dev/runtime-config.mjs`, `scripts/update/workspace-transition-state.mjs` | stderr `Config key not set: <key>` (`get_config_value`) | Loud: wrong error raised | wire capture golden (not yet asserted) |
| `server/device-settings.ts` | first line `<provider>: logged in` or `: logged out` (`hermes_cli/auth_commands.py:auth_status_command`) | Silent: status shows unavailable | probe (logged-out shape); wire capture |
| `scripts/dev/runtime-auth.mjs` | copied OAuth provider set (`auth_commands.py:_OAUTH_CAPABLE_PROVIDERS`) | Silent: stale provider list | none |
| `scripts/dev/runtime-auth.mjs`, `scripts/install/cli.mjs` | `-p default auth add --type`, `auth logout`, `-p default model` (`auth_commands.py`, `hermes_cli/subcommands/auth.py`) | Loud | none (interactive) |
| `server/device-settings.ts` | `tools enable` / `disable <toolset> --platform api_server` (`hermes_cli/subcommands/tools.py`) | Loud through `/v1/toolsets` readback | assembled |
| `scripts/dev/managed-plugins.mjs`, `scripts/update/workspace-transition.mjs` | `plugins doctor <dir> --ci`, `plugins enable <name> --no-allow-tool-override` (`hermes_cli/plugin_dev.py`, `hermes_cli/subcommands/plugins.py`) | Loud | `test/integration/dev-managed-assets.test.ts`; assembled |
| **Profile seed** (`runtime/seeds/profile/config.yaml`) | | | |
| `skills.external_dirs` with `${PYTHIA_MANAGED_SKILLS_DIR}` | `hermes_cli/config_defaults.py`; `agent/skill_utils.py` | Silent: no managed skills | probe |
| `plugins.enabled`, `platform_toolsets.{cli,cron,api_server}` | `hermes_cli/plugins.py`; `toolsets.py` | Silent: tools or prompt section absent | assembled (`/v1/toolsets`) |
| `auxiliary.free_only` | `agent/auxiliary_client.py` | Silent: paid fallback | none |
| **Plugin API and private Python seams** | | | |
| `runtime/managed/core/__init__.py`, `plugin.yaml` | `hermes_cli/plugins.py:PluginContext.register_tool`, `register_system_prompt_section`, `MAX_SYSTEM_PROMPT_SECTIONS_TOTAL_CHARS` | Loud through `plugins doctor` | probe (`native_hermes_plugin.py` dispatch); fixture `test_core.py` |
| `runtime/managed/core/desk_view.py` | native `session_id` keyword from `model_tools.py:handle_function_call` | Silent: view unavailable | manual `workspace-view.py`; fixture `test_desk_view.py` |
| `runtime/managed/runner/native_session_context.py` | private `agent/system_prompt.py:_restore_plugin_prompt_sections` | Loud import error; Desk shows unavailable | manual `workspace-session-context.py` |
| `runtime/managed/runner/native_session_context.py` | `hermes_state.py:SessionDB(read_only=True)`, `get_session`, `get_messages`, `get_compression_lineage`, `search_messages`, `get_messages_around`, `get_meta`, `fts_rebuild_status`, private `_fts_enabled` | Signatures loud; fields and semantics silent (wrong scope or unavailable) | manual; env-gated `test/native-session-context.test.ts` |
| **Native feature plugins** (`runtime/managed/core/platform/`, `runtime/managed/plugins/`; [seams](#qualified-market-data-extension-seams)) | | | |
| protected routes in `core/platform/http.py` | `ctx.register_platform_handler("api_server", factory)`; `BasePlatformAdapter._wire_plugin_handlers`, `APIServerAdapter.connect`; `_expected_api_key`, `_check_auth` | Loud: routes absent or unauthenticated | probe (`native_hermes_plugin.py`); assembled (`financial_http.mjs`) |
| operation ownership in `core/platform/access.py` | plugin manager `_registration_order`; `plugins.disabled` over `plugins.enabled`; registry tool schemas with `$comment` annotations | Silent: operations denied, or allowed after disable | fixture `test_financial_native_access.py`; assembled |
| bundled skill in `plugins/market-data/__init__.py` | `ctx.register_skill(name, path, description=...)`; qualified names in `skills_list`, `skill_view` | Silent: skill not discoverable | assembled (`plugin-skills.mjs`) |
| **HTTP API** (`server/hermes.ts`, `server/hermes-records.ts`, `server/hermes-inventory.ts`) | | | |
| bearer auth and error body | `api_server.py:_check_auth`, `_openai_error` | Loud | wire capture; fixture `test/hermes.test.ts` |
| `GET /v1/capabilities` `features.run_steer`, `model_options` | `api_server.py:_handle_capabilities` | Silent: steering hidden | wire capture |
| `GET /api/sessions` | `_handle_list_sessions`, `_session_response` | Silent: optional fields missing | wire capture; fixture `hermes.test.ts` |
| `POST`/`GET`/`PATCH /api/sessions[/{id}]`, `invalid_title` retry (also `server/routes.ts`) | `_handle_create_session`, `_handle_get_session`, `_handle_patch_session` | Mostly loud | wire capture (create, `invalid_title`); fixture `routes.test.ts` (PATCH) |
| `GET /api/sessions/{id}/messages?order=` and `pagination` | `_handle_session_messages`, `_message_response` | Silent | wire capture; fixture `hermes.test.ts` |
| `GET /api/model/options[?refresh=true]` (also `server/model-catalog.ts`) | `_handle_model_options`; `hermes_cli/inventory.py` | Silent: empty or wrong picker | fixture `model-catalog.test.ts` (not capturable offline: Hermes fetches remote catalogs) |
| `POST /v1/runs` body and 202 reply (also `server/attachments.ts`) | `api_server_runs.py:_handle_runs`; `api_server.py:_request_agent_overrides`, `_request_reasoning_config`, `MAX_REQUEST_BYTES` | Missing `run_id` loud; other fields silent | wire capture; fixture `hermes.test.ts` |
| `GET /v1/runs/{id}` fields and status values (also `client/run-terminal-event.ts`, `client/hermes-transport.ts`) | `api_server_runs.py:_handle_get_run`, `_set_run_status`, `_durable_run_status` | Silent: an unknown terminal value keeps Desk following the run | wire capture; fixture `run-lifecycle.test.ts` |
| `POST /v1/runs/{id}/approval`, `/steer`, `/stop` | `_handle_run_approval`, `_handle_steer_run`, `_handle_stop_run` | Loud on 4xx | wire capture; fixture `hermes.test.ts`, `routes.test.ts` |
| `GET /v1/skills`, `/v1/toolsets` (also `scripts/doctor/doctor.mjs`) | `api_server.py:_handle_skills`, `_handle_toolsets` | Loud: 502 on shape | assembled |
| **SSE events and run status** | | | |
| `server/hermes-events.ts` frame parsing and the qualified event names | `api_server.py:_sse_frame`; `api_server_runs.py:_handle_run_events` | Silent: renamed or new events dropped | wire capture; fixture `hermes.test.ts` |
| event fields in `server/hermes-events.ts`, `client/hermes-run-mapper.ts` | `api_server_runs.py:_make_run_event_callback`, `_text_cb` in `_handle_runs` | Silent | wire capture; fixture `hermes-transport.test.ts` |
| copied reasoning-tag strip in `client/hermes-run-mapper.ts` | `agent/conversation_loop.py` interim content callback (tags, 500 characters) | Silent: duplicated text | fixture `hermes-transport.test.ts` |
| `subagent.complete.status` in `client/run-delegations.ts` | `tools/delegate_tool.py` result statuses | Silent: shown as ended | wire capture (completed, failed) |
| **History rows and parsed strings** | | | |
| `display_kind: "hidden"` in `client/chat-message.ts` | `api_server.py:_project_client_message` | Silent: placeholder rows shown | wire capture |
| note `display_kind` values in `client/chat-message.ts` | `gateway/run.py`; `hermes_cli/cli_agent_setup_mixin.py`; `gateway/slash_commands.py` | Silent: notes shown as user bubbles | wire capture (`hidden`, delegation notices); `e2e/chat-layout.spec.ts` (`model_switch`); none for `auto_continue`, `personality_switch`, `skill_invocation` |
| `tool_calls` and the `tool_call` bridge in `client/chat-message.ts`, `components/chat/tool-copy.ts` | `tools/tool_search.py:TOOL_CALL_NAME` | Silent: generic tool label | wire capture |
| tool names in `components/chat/tool-copy.ts` | `tools/web_tools.py`, `file_tools.py`, `terminal_tool.py`, `process_registry.py`, `skills_tool.py` | Silent: generic copy | wire capture; fixture `turn-model.test.ts` |
| provider error wrappers in `components/chat/backend-error.ts` | error text from `api_server_runs.py:_handle_runs` | Cosmetic | fixture `backend-error.test.ts` |
| Pythia markers in `attachments.ts`, `workspace/references.ts`, `workspace/session-context.ts` | verbatim user content in `hermes_state.py`; search in `hermes_state_search.py` | Silent: context or scope lost | manual |
