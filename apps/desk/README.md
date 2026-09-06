# Pythia Desk

Pythia Desk is the local browser interface for Pythia Agent. It runs on
loopback beside the pinned, unmodified Hermes runtime. Hermes remains the
authority for conversations and execution; Desk keeps the Hermes bearer on the
server and translates only the qualified session and run APIs.

From the repository root:

```sh
just dev-init
just dev
```

The foreground command prints this worktree's Desk URL. `Ctrl-C` stops Desk,
Hermes, and Basic Memory together. Development state and ports are isolated per
worktree.

Choose a provider, model and reasoning effort beside the message box. The list
comes from Hermes, including its configured subscription and API-key providers.
The first send in an empty profile initializes its native provider/model default
and restarts Hermes; subsequent choices need no restart. The selection stays
selected while this Desk is open (including when switching conversations);
reloading returns to the native profile default. Selecting `Default` also uses
that default without sending an override. It never rewrites shared development
defaults, another worktree, or model credentials. Account setup still uses native
Hermes authentication; this is a model picker, not a new credential manager.

Unknown reasoning capabilities follow Hermes's permissive catalog behavior;
unsupported reasoning controls are disabled when Hermes explicitly reports
them. Hermes owns the final provider-specific effort mapping. A model appearing
in the catalog is not proof that the connected account can run it.

Run focused checks with:

```sh
pnpm --filter @pythia/desk check
pnpm --filter @pythia/desk test:unit
pnpm --filter @pythia/desk build
```

The browser never calls Hermes directly. Every privileged Desk route first
checks the loopback Host (or explicitly configured Tailscale access)
and requires same-origin request metadata or the
browser-session token. Mutations always require JSON and the CSRF token. Model authentication uses the
native repository command shown by the onboarding state; Desk does not read or
store OAuth or API-key credentials. A missing model selection is reported
separately from missing credentials or a provider authentication failure. For
shared development authentication and model defaults, see
[development](../../docs/development.md).

For optional HTTPS access through native Tailscale Serve, see
[development](../../docs/development.md#optional-tailscale-access) and
[hosting](../../docs/hosting.md). Host and account are operator configuration,
not repository defaults. Tailscale is never required for local access.

Device settings keep the two native Hermes controls separate: skills change
the profile's global `skills.disabled` list, while Desk tools change only the
`api_server` platform. Desk runs the pinned Hermes command under one external
mutation lock, asks the lifecycle owner to restart Hermes, and reports success
only after the authenticated native API shows the requested state. It does not
infer mismatches or modify another platform.

The SEC identity and EODHD token are optional. Desk writes them atomically to
the permission-restricted Pythia settings and secrets files and returns only a
readiness status. Stored values, the Hermes bearer, and OAuth credentials are
never returned to browser code or placed in command arguments.
