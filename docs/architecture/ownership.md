# Ownership and runtime boundary

Pythia has two kinds of local material.

## Managed material

The versioned checkout owns Pythia's skills, plugins, tools, applications,
dependency locks, and operating code. An explicit install or rebuild activates
the chosen checkout; the routine preview updater advances recorded clean
`main`. Hermes is an exact, unmodified dependency managed by Pythia, not a
second product control plane.

Pythia sets Hermes's native `HERMES_DISABLE_LAZY_INSTALLS=1` when running
the agent, so importing an optional provider does not silently change the
locked runtime environment. This is dependency management, not a sandbox:
explicit user installations remain possible, and Hermes's native
`HERMES_LAZY_INSTALL_TARGET` can select a separate writable dependency target.

Profile, SOUL, and workspace defaults are seeds: Pythia creates them only when
absent. Once created, they are device-owned rather than update-owned.

## Investor-owned material

Credentials, sessions, memory, Markdown knowledge, local configuration,
capability choices, caches, and local extensions belong to the device and are
preserved across Pythia updates. Markdown remains readable and user-owned.

Users extend Pythia through [Hermes-native feature packages](plugins.md), local skills, and
configuration. Native Hermes precedence lets a same-name local skill override a
standalone external skill. Bundled plugin skills have qualified names; a flat
local name does not replace them. Customize the owning plugin or use native skill
disablement. Pythia does not add a parallel extension registry.

The [market-data owner](market-data.md) owns canonical financial meaning,
identity, compatible source selection and resident request coordination. Provider
plugins contribute native capabilities and evidence. The existing gateway hosts
one shared HTTP/tool backend per profile; standalone CLI shares durable state and
implementation, not memory. Protected transport, authentication and limits belong
to Pythia, not to individual connectors. No concrete shared connector is bundled
in the foundation increment; core SEC/EOD tools remain independent.

## Source is not runtime input

The checkout may also hold developer-facing source, including Design Lab and
builder guidance. These files remain public for development, but are excluded
from every automatic runtime consumer unless explicitly allowlisted. In
particular, the repository-root builder `AGENTS.md` and `.agents/` are never
shipped, served, executable, scanned by Hermes, copied into profiles/plugins,
or injected as ordinary model context. A separately seeded workspace
`AGENTS.md` is user-owned native runtime context. These allowlists prevent
accidental injection; they do not claim that a same-user filesystem-capable
agent cannot read public source during explicitly approved maintenance.

## Source, generated copies, and device state

The installed lifecycle keeps these boundaries explicit:

| Kind | Authoritative paths | Derived consumers | Update rule |
| --- | --- | --- | --- |
| Managed skill bundles | `<checkout>/runtime/managed/skills/<skill>/`, including `SKILL.md` and native supporting files | Hermes reads the bundle from the configured external directory | Update from the chosen checkout; never flatten or mirror into another registry. |
| Managed runners | `<checkout>/runtime/managed/runner/sec.py`, `eodhd.ts` and `native_session_context.py` | SEC uses the locked managed Python environment; EODHD uses compiled output; native session context uses the pinned Hermes environment | Install the corresponding frozen dependency environment before compiling or invoking changed code. |
| Managed plugins | `<checkout>/runtime/managed/plugin/` and the explicit `runtime/managed/plugins/market-data/` payload, including bundled skills | Exact copied files at `<profile>/plugins/<native-name>/` | Refresh only receipt-proven managed contents; preserve edited or unowned replacements and native enablement. No symlink. |
| Desk | `<checkout>/apps/desk/` and its workspace dependencies | Dependency tree and production `.next/` build in the checkout | Frozen dependency install precedes the production build. |
| Pinned native runtimes | `runtime/versions.json` plus managed locks | Pythia-owned Hermes source/environment and managed Python environment below `<runtime>` | Native frozen sync updates the existing environment; refreshed managed inputs do not discard a usable `.venv`. |
| Seeds | `<checkout>/runtime/seeds/` | Profile SOUL/config defaults and workspace files | Copy only inside the first initialization transaction. The destination becomes user-owned; a later missing seed is not silently recreated. |
| Device-owned state | `<config>` profile/auth/settings and local extensions; `<data>` workspace, knowledge, sessions, and memory | Native Hermes and Desk; legacy Basic Memory state is retained for explicit transition | Preserve across preparation, rebuild, update, and uninstall unless an explicit destructive operation says otherwise. |
| Generated activation files | Installed command, role-scoped service environments, rendered user units, dependency/build output, and lifecycle receipts | The foreground or installed processes | Replace only through the lifecycle lock and transaction; never treat generated bytes as user configuration. |

The preparation order is source selection, frozen dependency synchronization,
compilation, copied-plugin validation, generated activation files, and only
then process activation and health verification. Directly read source and
copied/compiled output must all come from the same selected checkout. A restart
without the required copy or build is not source activation.

Explicit preview install or rebuild selects the files already in the user's
checkout, including a detached ref or uncommitted edits, and performs no Git
fetch or reconciliation. The routine updater is a different owner: it follows
`origin/main` by fast-forward only and refuses dirty, conflicted, diverged, or
changed-after-preflight source. Neither path stashes, resets, rebases, merges a
fork, or invents source provenance. An activation receipt may state the base
revision and whether local changes were present, but local source is not
described as pristine or signed.

## Managed-source edits

During the technical preview, an agent proposing to edit managed source must
first explain the precise change and the consequence for future updates or a
fork, then receive explicit user approval. This is advisory guidance, not a
security boundary or enforcement mechanism.

## Selective adoption

Pythia adopts, adapts, or rejects individual ideas and files based on their
fit with this product. It does not import prior repository history or copy
experimental device state. Private records, credentials, investment data,
generated state, and machine-specific assumptions do not belong here.

## Research and context ownership

[ADR 0013](../decisions/0013-workspace-and-native-research-context.md) makes
`PYTHIA_WORKSPACE` the common ordinary-file root for working and durable research.
Desk owns a bounded, admitted read-only projection, never another agent file tool
or write authority. Native Hermes owns memory, file operations, sessions, skills
and compaction. Optional strategy associations are explicit native conversation
notes referencing ordinary briefs, recovered by a narrow native read-only helper;
there is no strategy/session database or research index.

The private transient Desk-view cache belongs to device state outside research.
Desk alone publishes it; the copied Pythia plugin reads a short-lived reference
bound to the native session. Its location is role-allowlisted to Desk and Hermes,
not provider runners. The core payload also includes explicitly allowlisted
platform transport support. The native context helper is a separately allowlisted
runner, not another service.

Preparation of an existing Basic Memory installation first checks its explicit
[transition](../update-and-customization.md#workspace-transition). A pending
transition must stop before dependency synchronization or service replacement can
remove the old environment. Original knowledge/configuration and user choices
remain owned by the investor. Restarting services does not replace cached native
conversation instructions; fresh-session adoption and legacy notices make that
boundary visible.
