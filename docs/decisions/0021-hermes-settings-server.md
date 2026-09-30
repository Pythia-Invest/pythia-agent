# Hermes settings through Hermes's own settings server

Status: accepted, 2026-09-24.

## Context

Desk's Settings were hand-written pages over a few device settings, and each
new provider or plugin needed Desk code. Hermes Desktop, the owner's reference,
shows hundreds of Hermes settings, provider accounts and keys, custom
endpoints, MCP servers and plugins, generated from Hermes's config schema. It
reads and writes them through Hermes's settings server (`hermes serve`, the
web server behind `hermes dashboard`). Pythia ran only Hermes's API server,
which serves chat (`/v1/*`) and none of these endpoints.

Two ways to give Desk the same settings: run Hermes's settings server beside
the API server, or have Desk write Hermes's `config.yaml` and `.env` itself.
The second copies Hermes's schema, credential handling and provider catalog
into Desk and drifts with every Hermes release, which is the scaling problem
this replaces. The pinned Hermes (`runtime/versions.json`) serves every
endpoint Settings needs.

## Decision

Pythia runs Hermes's settings server as a third owned service:
`hermes -p <profile> serve --isolated --host 127.0.0.1 --port <settings>`.
`--isolated` scopes it to Pythia's profile rather than a machine-wide Hermes
server. It listens only on loopback: port 8646 when installed
(`pythia-agent-hermes-settings.service`), and `43000 + slot` in development,
above the existing three-port slots so development stacks keep their
addresses. Without `HERMES_DESKTOP` it runs no cron ticker or gateway of its
own; the API server remains the only chat host.

It authenticates with its own bearer, `hermes_settings_token` in
`<config>/secrets.json`, issued once and added in place to existing stores.
The launcher and development supervisor give each service only its own
bearer: the chat server the API key, the settings server its token, Desk both.

The browser never talks to it. Desk's server calls it through
`apps/desk/src/server/hermes-settings.ts` and exposes narrow routes under
`/api/hermes/` behind the usual browser admission. The shape functions in
`hermes-settings-shape.ts` are the boundary:

- Config reads return only fields a Settings page shows, flat by key; writes
  accept only those keys, refuse credential-shaped keys, and send Hermes a
  partial config it deep-merges. The main model changes through Hermes's
  model assignment. Pythia-owned config (the working folder, toolsets,
  plugins, MCP servers, provider definitions, Hermes's update settings) is
  never shown or written through this config path. Secrets are dropped at
  any depth, including an `api_key` inside a fallback entry; because Hermes
  replaces lists on save, an unchanged entry the browser sends back gets its
  secret restored from Hermes's current config. A value must match its
  field's declared type and choices. `terminal.env_passthrough` is not
  offered, since it would hand a stored key to the agent's shell.
- Provider keys come back as set or not with the last four characters Hermes
  displays; a key can be set or cleared only if Hermes lists it as a provider
  key. `/api/env/reveal`, raw config, and Hermes's own update endpoints are
  not exposed.
- Sign-ins return the https verification page, user code and status, never a
  token preview or a local credential path.
- Plugins and MCP servers can be switched on and off through Hermes's own
  plugin and MCP endpoints, which also rewrite platform toolsets. Each switch
  takes the device's capability mutation lock and restarts Pythia's chat
  server, as skills and toolsets do, because that server loads plugins and MCP
  servers when it starts. Only a plugin Hermes lists can be switched, by its
  exact name; path-like names are refused. Pythia's own plugin cannot be
  switched off.

Skills and `api_server` toolsets keep their existing native commands, restart
and readback (credential custody), since those are what Pythia's chat server
reads.

## Consequences

Settings shows what Hermes supports, and new Hermes settings reach Desk by
adding a field to a page, not a backend. A second long-running Hermes process
uses memory and must be kept in step with the pin; the Hermes touchpoint index
records the endpoints Desk depends on. The settings server reconciles Hermes's
session database and runs Hermes's auto-archive timer, as it does beside any
Hermes gateway. Its changes apply to new sessions; `.env` is reloaded per
gateway turn.

## Rejected alternatives

Desk writing `config.yaml` and `.env` itself (duplicates Hermes and drifts);
exposing the settings server to the browser (its token and reveal endpoints
would reach page code); a machine-wide Hermes server (shared with the user's
own Hermes, outside Pythia's profile); keeping hand-written settings pages.
