# Hermes contract

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

Pythia copies exactly one plugin into
`<profile>/plugins/pythia/{plugin.yaml,__init__.py}`; it never symlinks or
installs it as a package. Its manifest declares its name, version, description,
and provided tools. Before activation, the copied directory must pass:

```text
hermes -p <profile> plugins doctor <copied-plugin-directory> --ci
hermes -p <profile> plugins enable pythia --no-allow-tool-override
```

`doctor --ci` uses the production manifest/import/register path and exits
nonzero on a diagnostic error, but is validation rather than a security
sandbox. The plugin must expose `register(ctx)` and may use only:

- `ctx.register_system_prompt_section(id, content, position="after_memory",
  max_chars=<at most 4000>)`; Hermes caps the combined registered prompt at
  8,000 characters and 32 sections. It is frozen when a new session is built.
- `ctx.register_tool(name, toolset, schema, handler, check_fn=None,
  requires_env=None, is_async=False, description=None, emoji=None,
  override=False)`. Pythia never overrides a built-in name or capability.
  Handlers return a JSON-serializable value or string and convert bounded
  provider failures to the Pythia result shape.

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
no active matching approval is 409. Stop is
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
