# 0004: One foreground owner per development worktree

Local development on macOS and Ubuntu uses one Pythia process to supervise the
native pinned Hermes gateway, the native pinned Basic Memory HTTP MCP, and
Pythia Desk. It owns readiness, signal propagation, and teardown; it does not
install a service, change host networking, or use a global Hermes installation.

The real worktree path deterministically selects its stack ID, lowercase Hermes
profile, loopback ports, and XDG data/state/cache roots. A private receipt stores
process start identities. Each direct service has a Pythia-owned POSIX process
group so pnpm/Next and other grandchildren receive the same bounded teardown.
Status, stop, and reset operate only on that resolved stack and refuse stale or
foreign identities and occupied ports.

Development settings changes use one narrow lifecycle operation instead of
Hermes's installed-service restart command. An exclusive request receipt bound
to the live supervisor and Hermes generation triggers `SIGUSR1`; the supervisor
replaces only its receipt-owned Hermes process group, waits for native health,
then acknowledges the new generation. Callers cannot select a PID, command, or
path. Concurrent requests join the same restart, while Basic Memory and Desk
remain running. Any sibling failure still tears down the whole stack safely.

Managed runtime source changes use a separate explicit refresh. Desk keeps its
native hot reload, but Pythia does not watch plugin, runner, skill, or dependency
source and restart services automatically. Refresh stops all three consumers
owned by the selected worktree, reuses the shared frozen preparation path, then
restarts and acknowledges only healthy replacements. A stopped stack may be
prepared without starting services. User data, shared credentials, profile
configuration, and capability choices are not reset.

The same derived environment gives managed tools absolute paths to managed
source and locked interpreters plus private, per-worktree EDGAR data/cache.
Configuration has one canonical root and secrets retain one canonical transport;
development does not introduce compatibility aliases.

One permission-restricted Hermes root owns OAuth credentials for every named
worktree profile through Hermes's native fallback and locking. Profiles and
mutable application data remain isolated. Pythia passes exact roots on every
invocation and selects the lowercase profile on every profile-scoped command.
The sole native bootstrap exception is `hermes profile create <profile>`:
Hermes cannot select a profile that does not exist yet. Pythia never copies or
links auth records. Managed plugin code is also copied rather than linked.
Fresh Pythia seeds replace only the known scaffold
created in the same unpublished profile-initialization transaction; later
local edits are preserved. A private transaction marker fails closed after an
interrupted first initialization; an explicit recovery command may remove only
the marker-owned partial profile and never the shared credential root. A
`started` marker proves intent but not completed native creation, so it cannot
authorize deletion when a profile exists.

The explicit boundary makes source activation predictable and keeps a settings-
only Hermes restart small. Automatic source watchers, restarting only the copied
plugin consumer while shared dependencies change, systemd-backed development,
and a new worktree manager were rejected as unnecessary lifecycle machinery.
