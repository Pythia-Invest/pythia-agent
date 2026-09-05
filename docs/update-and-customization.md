# Updates and customization

Pythia keeps one live Git checkout. Device-owned configuration and data remain
outside it. Explicit source activation and routine Git updating are separate
operations with deliberately different preconditions.

## Rebuild the source you selected

```sh
pythia rebuild
```

`rebuild` activates the checkout exactly as it exists, including another
branch, a tag, detached HEAD, or tracked and untracked edits. It does not fetch,
switch refs, reconcile Git, require a clean tree, run CI, or require a signed
release. It prepares frozen dependencies before compiling, refreshes copied
managed assets, and preserves credentials, data, configuration, and native
choices. The receipt reports the available base revision and local-source
status without calling arbitrary source pristine or signed.

A local fork therefore remains usable. Rebuilding a clean checkout on recorded
`main` restores eligibility for the routine preview updater; rebuilding another
source does not silently convert it to `main`.

## Update recorded `main` safely

```sh
pythia check-update
pythia update
```

The technical-preview updater follows `origin/main` only when the installed
source records clean `main`. It is a manual command and accepts a fast-forward
only. Stable tag discovery and signature verification are designed for a later
stable channel; no stable release is currently published.

Before stopping services or changing source, the updater requires the checkout
to be clean, owned, and conflict-free. It never stashes, merges, rebases,
resets, or overwrites local work. It fetches the exact target, stops all three
services, advances the checkout, prepares pinned dependencies before
compilation, refreshes managed copies, runs migrations, and trial-starts with
boot still disabled. After health succeeds, it durably records source metadata
and the completed transaction before enabling normal startup.

If an update's preparation or startup fails, the Pythia target remains disabled
and stopped across reboot and a transaction receipt keeps the exact old and new
revisions. If the lifecycle cannot confirm that state, it reports the failure
rather than claiming safety. Fix the reported cause, then run:

```sh
pythia recover
```

Recovery uses the receipt's target even if the remote has moved and re-enters
the same complete-before-enable boundary. Inspect `pythia status` and
`pythia doctor` before manually starting anything.

If an explicit rebuild fails, inspect the same status and doctor readbacks, fix
the cause, and rerun `pythia rebuild` from the chosen checkout. `pythia recover`
does not resume install or rebuild transactions.

## What Pythia owns

Managed, source-updated material includes Desk, Pythia skills, the Pythia
plugin, bounded data runners, dependency locks, installer code, and operating
source. Hermes itself is an exact, unmodified release installed in Pythia's
private runtime.

Device-owned material includes credentials, sessions, Markdown knowledge,
workspace files, local configuration, capability choices, and local Hermes
extensions. Profile, SOUL, workspace, and knowledge defaults are installed only
in the first initialization transaction. Updating or rebuilding Pythia does not
reapply them or recreate a later-deleted seed over user choices.

The repository also contains public development material such as docs,
`AGENTS.md`, `.agents/`, tests, and Design Lab. Explicit runtime allowlists keep
those files out of Hermes scan roots, plugin copies, executables, and ordinary
model input; there is no second hidden release tree. Explicit approved source
maintenance can read public source, so this is an automatic-consumer boundary,
not a promise that a same-user agent cannot access files.

## Native Hermes customization

Pythia uses Hermes's own extension and configuration rules:

- Global skill enablement is the profile's native `skills.disabled` value.
- Desk tool controls call native `hermes tools enable/disable ... --platform
  api_server`.
- Desk reads the authenticated native `/v1/skills` and `/v1/toolsets` APIs and
  shows Hermes's full reported toolset inventory with enabled flags.
- Local profile plugins and project or profile skills use native Hermes
  mechanisms. A local skill with the same name may override Pythia's managed
  skill; Pythia does not add an extension registry.

A fresh profile explicitly enables the same ten base toolsets for `cli`,
`cron`, and `api_server`: `cronjob`, `delegation`, `file`, `memory`,
`session_search`, `skills`, `terminal`, `todo`, `vision`, and `web`. The Pythia
plugin adds `pythia-sec` and `pythia-eodhd`. These are initial values only;
later native user edits are preserved.

Managed skills declare native `metadata.hermes.requires_toolsets` when they
need a tool. Where Hermes has toolset information, it uses that metadata to
omit an unavailable skill from the generated prompt. On another Hermes
platform, enabled tools may differ and the skill may therefore be absent from
that prompt. If toolset information is unavailable, Hermes's native behavior is
to leave the skill visible. This is prompt relevance, not a security control,
and Pythia does not calculate mismatches, hide entries, repair settings, or
synchronize platforms.

## Editing managed source

Changing tracked managed source creates a local fork in practical terms. The
installed agent is instructed to explain the exact edit and its update
consequences and obtain explicit approval first. That instruction is advisory,
not enforced access control.

Once the checkout is dirty, `pythia update` fails closed, while
`pythia rebuild` remains available to activate the chosen local source. Commit
the fork and reconcile upstream changes yourself, or restore a clean recorded
`main` checkout by a method that preserves any work you want to keep. Pythia
deliberately has no automatic conflict resolver or worktree manager.

Prefer local Hermes skills, plugins, and profile configuration when a native
extension is sufficient. They survive ordinary updates without modifying the
managed checkout.

## Uninstall

```sh
pythia uninstall
```

The default removes the installed command, managed runtime, and user services
but retains the checkout, configuration, state, workspace, and Markdown
knowledge for reinstallation. `pythia uninstall --purge` also removes Pythia
configuration, state, and cache, but still does not delete the checkout,
workspace, or Markdown knowledge. Back up and remove retained data separately
only when that destructive result is intended.
