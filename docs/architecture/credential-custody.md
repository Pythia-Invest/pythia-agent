# Credential and settings custody

All paths below are device-owned and outside the Git checkout. `<config>` is
`${XDG_CONFIG_HOME:-$HOME/.config}/pythia`, `<state>` is
`${XDG_STATE_HOME:-$HOME/.local/state}/pythia`, and `<data>` is
`${XDG_DATA_HOME:-$HOME/.local/share}/pythia`. Their directories are mode
`0700`. A writer uses a same-directory mode-`0600` temporary file, flushes it,
and atomically renames it; it never logs old/new values. Browser code receives
only readiness such as `configured`, `missing`, or `invalid`, never stored
values or a direct bearer token.

| State/value | Sole store and owner | Sole writer | Transport and precedence | Apply/readiness | Update, migration, uninstall |
| --- | --- | --- | --- | --- | --- |
| Model OAuth and API-key credentials | `<config>/hermes/auth.json`, mode `0600`, under the permission-restricted Hermes root | Root-scoped native `hermes -p default auth add --type oauth` or `--type api-key`, native logout, and native refresh under `auth.lock` | Named profiles read root fallback; an explicit profile provider/pool entry shadows it. Hermes receives `HERMES_HOME` and explicit profile scope; no copy, symlink, browser value, or argv secret. | Native `hermes -p default auth status <provider>` is redacted. Refresh is live; authentication may require a new session, not a Pythia rewrite. | Pythia releases never migrate content. Retain on update/uninstall; explicit purge removes only after confirmation. |
| Shared development model defaults | `<config>/hermes/config.yaml`, native `model` field | `just model` invokes native `hermes -p default model` | Development preparation copies provider/model/endpoint/API-mode fields into an empty profile and fills a missing selected simple custom-provider route through native config commands; no credentials or general config merge. See ADR 0037. | A running empty profile needs stop/start after selection. Existing and partial profile choices take precedence and are preserved. | New defaults apply only to unconfigured development profiles. Not transported to another device or reconciled on updates. |
| Global skill enablement | `<config>/hermes/profiles/<profile>/config.yaml`, mode `0600`, Hermes-owned field `skills.disabled` | Native `hermes config set`; the Pythia server is the only orchestrating caller and holds one mutation lock | Native project/profile/external precedence and global disabled state remain authoritative. Pythia never writes `skills.platform_disabled`, stores a mirror, or combines this value with toolset state. | Restart Hermes; require the requested global result in authenticated `/v1/skills` readback. | Preserve across release. Explicit versioned migrations invoke the same native command and verify. Retain on uninstall/purge only with the whole profile. |
| `api_server` toolset enablement | The same profile `config.yaml`, Hermes-owned platform tool configuration | Native `hermes tools enable/disable <toolset> --platform api_server`; the Pythia server is the only orchestrating caller and holds the mutation lock | The command targets only `api_server` and preserves every other platform. No Pythia mirror or combined capability value exists. | Restart Hermes; require the named entry's requested `enabled` value in authenticated `/v1/toolsets`. | Preserve across release and migrations through the same native command. Retain on uninstall/purge only with the whole profile. |
| Plugin enabled state | Same profile `config.yaml` | Native `hermes plugins enable/disable`; lifecycle only copies managed plugin code | Profile-local copied plugin; no symlink or package installation. | A source refresh takes effect in a new process/session; restart then use native authenticated readback where applicable. | Refresh only content-proven managed copies. Preserve edited/replaced packages and existing enabled choices; fresh-profile defaults are explicit. Copy receipts contain hashes, never capability state. Profile retained by default. |
| Hermes API bearer | `<config>/secrets.json`, mode `0600`, field `hermes_api_key` | Pythia device-settings service | Environment only to Hermes and Desk server processes. It never enters browser JavaScript, URL, argv, or logs. No alternate environment/file owner. | Restart both processes; server performs authenticated readiness and reports only ready/not-ready. | Preserve across updates. Retain on uninstall; explicit purge removes. Rotation writes once then restarts both together. |
| Retained legacy SEC identity | `<config>/settings.json`, mode `0600`, field `sec_identity` | No active core writer; preserve existing value during unrelated settings writes | No active core tool, browser readback or subprocess forwarding. Ambient provider values remain excluded. | No setup/readiness control in core; a future SEC integration owns its supported connection. | Preserve across updates and uninstall; removal only through explicit whole-profile purge. No automatic migration. |
| Retained legacy EODHD token | `<config>/secrets.json`, mode `0600`, field `eodhd_api_token` | No active core writer; preserve existing value during unrelated secret writes | No active core tool, browser readback or runner forwarding. Never browser/argv/log. | No setup/readiness control in core; a future EODHD integration owns its supported connection. | Preserve across updates and uninstall; removal only through explicit whole-profile purge. No automatic token migration. |
| Pythia-only settings | `<config>/settings.json`, mode `0600`, namespaced non-secret fields | Pythia device-settings service | One immutable service snapshot; no Hermes duplicate. | Setting-specific reload, otherwise coordinated service restart; redacted settings readback. | Versioned atomic migration with receipt. Preserve on update/uninstall; purge removes. |
| Legacy Basic Memory configuration and Markdown | Existing stack config and knowledge paths, retained as investor-owned state | Explicit lifecycle workspace transition; owned MCP disable uses native Hermes config commands | Original configuration and notes are preserved; no default Basic Memory process on fresh stacks. | Staged verified copy, reviewed instruction choices and fresh native-session guidance checkpoint before retirement. | Backups/receipts and original notes survive interruption; no automatic migration, rewrite or deletion. |
| Workspace research and strategy briefs | Canonical `PYTHIA_WORKSPACE`, ordinary investor-owned files | Native Hermes file tools or user/editor; Desk is read-only | Browser access uses admitted host API and validated paths; strategy references do not switch cwd or profile. | Readers show latest available contents with an update notice and preserve reading position where practical; reads report missing and partial states. | Preserve originals across updates; no new document schema or derived research index. |
| Current Desk view | Private per-stack `PYTHIA_DESK_VIEW_STATE` outside workspace | Desk publisher under browser admission and CSRF | Opaque per-turn reference binds browser/tab/native session; plugin reads bounded record, provider children receive no location. | Foreground publication; 60-second expiry, restart/session mismatch returns unavailable. | Transient cache, never investor memory or durable research; no global last-tab fallback. |
| Release channel | `<config>/release.json`, mode `0600`, field `channel` (`stable` or `preview`) | Pythia lifecycle command | Explicit install/update option; stored value wins over ambient environment. | Atomic readback before discovery; report channel, never change implicitly. | Preserve. Changing channel is an explicit lifecycle operation. Retain on uninstall; purge removes. |
| Release trust root | `<state>/release-trust/allowed_signers`, mode `0600`; current installed state is authority | Pythia lifecycle command, copying only trust data from a candidate already verified by the old file | Passed as `gpg.ssh.allowedSignersFile` to system Git. Candidate checkout/key and GitHub display do not override the current file. | `git verify-tag` exit status; report signer fingerprint and failure class. | First install copies the checkout's bootstrap file with the documented TOFU limit. An old-trusted release may add a new key; a later trusted release may remove the old, always after verification and by atomic replacement. Retain on uninstall; purge removes. |
| Lifecycle lock and transaction receipt | `<state>/lifecycle.lock` and `<state>/transactions/`, mode `0600` | Pythia lifecycle command | Outside mutable checkout; one install/update/uninstall/start/stop writer. Receipts contain revisions/status only, no secret. | Owner-checked lock plus readback; stale ownership is handled explicitly. | Preserve useful recovery receipts; bound retention. Uninstall removes runtime receipts after success, purge removes all. |

The Pythia settings service admits only server-side validated requests and is
the atomic writer for its two files. It cannot modify native Hermes stores
directly. Missing optional provider configuration never prevents
ordinary startup.

Desk may initialize an empty profile's native `model.provider` and
`model.default` from the user's first explicit authenticated model selection.
The settings service holds its mutation lock, invokes native dotted setters,
checks config readback, and restarts Hermes before submitting the run. It never
writes YAML directly or changes existing/partial selections, shared defaults,
or credentials. If interrupted between setters, complete the partial selection
through native Hermes configuration; no automatic repair guesses user intent.

## Shared custom providers in development

[ADR 0037](../decisions/0037-shared-development-provider-defaults.md) extends
model-default inheritance with the selected provider's non-secret native routing.
Configure supported routing under the default profile's `providers` mapping and
store the credential in its native root authentication pool, using
`just auth custom:<name> api-key`. An existing root `.env` value alone is not a
shared profile credential: explicitly register it through native authentication.
Neither initialization nor readiness copies secrets or checks authentication.
Profile-specific pools override shared credentials; existing `.env` and custom
configuration remain user-owned. Root routing defaults are copied only when the
selected route is missing, never reconciled over profile overrides.
