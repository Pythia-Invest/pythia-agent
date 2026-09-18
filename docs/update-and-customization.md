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
resets, or overwrites local work. It fetches the exact target, completes preservation preflight, stops both
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
extensions. Profile, SOUL and workspace defaults are installed only
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
  mechanisms. A local skill with the same name may override a standalone
  external skill. Bundled plugin skills have qualified names; customize their
  owning plugin or disable that qualified skill. Pythia does not add an
  extension registry.

Bundled plugin installation and initial enablement are separate release choices.
Fresh profiles enable the core `pythia` plugin and `pythia-market-data` through
Hermes. A supported optional plugin can be shipped without being enabled; users
enable it through native Hermes configuration. Later rebuilds and updates retain
the existing enabled and disabled choices. Community plugins use normal Hermes
installation and discovery and need no entry in Pythia's release payload list.

Each managed copy carries `.pythia-managed-copy.json`, a content receipt listing
its copied files and hashes. Updates replace a directory only when its contents
still match that receipt. A changed or missing file, additional local file,
invalid receipt, or linked directory preserves the whole plugin and produces an
explicit update-skipped report. A local replacement remains user-owned, including
when it uses the same native plugin name. Hermes diagnoses its compatibility;
preservation does not certify that it implements the APIs required by other
enabled plugins. Dependent registration fails visibly if required support is
missing.

Older copies without receipts are adopted only when their complete contents
match the selected payload or an explicitly recorded prior release fingerprint.
Unknown older copies are preserved for explicit reconciliation. Recognized
CPython bytecode caches for copied Python modules are generated state and can be
discarded during replacement; other extra files remain ownership conflicts.

Release payloads allowlist individual nested skill and asset files, with real
directories and regular files throughout. A plugin payload admits at most 512
files, eight path components, 8 MiB per file, 32 MiB in total and a 256 KiB
serialized receipt. Preparation
validates all selected inputs before copying. Core validation uses native plugin
doctor. Since that command isolates a single plugin, dependent feature packages
are qualified with their copied dependencies together; ordinary updates do not
claim an independent doctor pass for a preserved replacement or dependent feature.

A fresh profile explicitly enables the same ten base toolsets for `cli`,
`cron`, and `api_server`: `cronjob`, `delegation`, `file`, `memory`,
`session_search`, `skills`, `terminal`, `todo`, `vision`, and `web`. The Pythia
plugin adds `pythia-sec` and `pythia-eodhd`. These are initial values only;
later native user edits are preserved.

Standalone managed skills declare native `metadata.hermes.requires_toolsets` when they
need a tool. Where Hermes has toolset information, it uses that metadata to
omit an unavailable skill from the generated prompt. On another Hermes
platform, enabled tools may differ and the skill may therefore be absent from
that prompt. If toolset information is unavailable, Hermes's native behavior is
to leave the skill visible. This is prompt relevance, not a security control,
and Pythia does not calculate mismatches, hide entries, repair settings, or
synchronize platforms.

Bundled plugin skills use native `ctx.register_skill` and travel with their
owning feature. At the pinned release they are discovered through `skills_list`
and `skill_view`, rather than added to that automatic prompt index. Their native
qualified names and global/platform disablement remain authoritative.

## Editing managed source

Changing tracked managed source creates a local fork in practical terms. The
installed agent is instructed to explain the exact edit and its update
consequences and obtain explicit approval first. That instruction is advisory,
not enforced access control.

Once the checkout is dirty, `pythia update` fails closed, while
`pythia rebuild` remains available to activate the chosen local source. Commit
the fork and reconcile upstream changes yourself, or restore a clean recorded
`main` checkout by a method that preserves any work you want to keep. Pythia
deliberately has no automatic conflict resolver, and its installed lifecycle
does not manage worktrees. The source repository has contributor-only worktree
recipes; `just worktree` wraps native Git for sibling development checkouts and
is never invoked by install, rebuild, update, or runtime commands.

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

Uninstall and purge refuse a pending Workspace transition or a retained Basic
Memory unit before stopping or removing anything. Complete the transition first;
custom or unconfirmed legacy units remain untouched. The absence check also
applies when the Hermes profile is missing.

Default uninstall retains the profile-initialization receipt. A successfully
initialized Workspace profile carries its adoption marker there, bound to the
same stack, checkout and Hermes profile. Reinstall can therefore preserve and
reuse that profile after the runtime activation receipt and binaries are removed.
Migrated profiles retain their completed transition receipt instead. Neither
path infers adoption from prompt text or from a missing runtime receipt.

## Workspace transition

Fresh stacks use Hermes and one ordinary workspace. Existing Basic Memory state
requires an explicit staged transition before dependency synchronization, refresh,
rebuild or update can remove its usable environment. This is not a startup
migration and does not delete legacy research. Back up your device-owned data
before an intentional lifecycle change.

Installed preview:

```sh
pythia workspace-transition
```

Development equivalent, from the selected worktree:

```sh
node scripts/dev/cli.mjs workspace-transition
```

The read-only preview reports an `expected` state token, old MCP and unit
ownership, the knowledge inventory, unsupported `memory://` or `[[wiki]]` links,
and exact before/after seed text for workspace AGENTS/README and profile SOUL.
Review these results. A custom MCP binding, unrelated unit or drop-in requires
resolution rather than forced retirement. The profile must have completed its
owned initialization transaction.

Stage with the preview token and an explicit choice for each changed seed:

```text
pythia workspace-transition --apply --expect <preview.expected> \
  --adopt-seed <source> --retain-seed <another-source>
```

`<source>` is the source name reported in the preview, such as
`workspace/AGENTS.md`, `workspace/README.md` or `profile/SOUL.md`. Repeat the
appropriate option for each changed seed. Adoption applies that reviewed seed
diff; retention records the user's decision to keep their reconciled/custom or
missing file. It does not infer that customized instructions match new defaults.
Development uses the same options on `node scripts/dev/cli.mjs` and requires the
stack stopped for apply/complete.

Staging preserves configuration and adopted-seed originals in the stack state's
`workspace-transition-backup/`, with a `workspace-transition.json` receipt.
It copies notes into a collision-free `workspace/imported-research-N` directory,
preserving relative layout and verifying bytes. Originals remain accessible;
unsupported links are reported without rewriting. Only the exact owned old MCP
binding is disabled through native Hermes commands. Current plugin files are
copied and checked with native doctor while enabled/toolset choices are preserved.
The old executable, environment and service remain available during this stage.

Then explicitly restart the owned Hermes and start a new native chat after
staging. The transition never sends a model request for you. On development,
`just dev` in staged state starts the preserved environment without dependency
sync/build/copy; create the fresh chat, then stop the stack before completing.
Installed users can use the existing explicit `pythia restart-hermes` operation.
A newly selected profile toolset remains the user's choice in native settings.

Complete against the new native session:

```text
pythia workspace-transition --complete <session-id>
```

The native read-only checkpoint requires a session created after staging with
the current managed operating marker. It also verifies notes, configuration,
selected seeds and copied plugin. Only then can the exact owned old installed
unit be retired and ordinary rebuild/refresh/init synchronize dependencies
without Basic Memory. The receipt phases are `copying`, `staged`, `completing`
and `complete`; rerunning the appropriate operation resumes an interruption.
Intervening user edits produce an explicit preservation/error result, not an
automatic merge or overwrite. Keep the backups and original notes.

Old chats keep their native stored prompts. Ordinary resume does not refresh
those bytes merely because services restarted. Desk's legacy notice offers
“Continue in a new chat,” carrying a prior-session reference for native selective
recall. No transcript is copied and no native history is rewritten. Native
compaction can refresh prompt sections, but fresh-session adoption is the
reliable transition checkpoint. See [ADR 0013](decisions/0013-workspace-and-native-research-context.md).
