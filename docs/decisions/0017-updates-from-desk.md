# 0017: Application updates from Desk

## Context

Desk exposed release availability but required a host terminal to apply it.
An investor using a remote installed device needs current version and build
identity, an explicit check, and one clear action to install an available build.
The existing updater stops Desk along with the Pythia target, so launching it as
a child of the Desk service would interrupt its own update.

## Ruling

Settings shows the activated version, full build identity on hover, channel,
check result and last check time. The navigation footer's update entry,
shown only while an update needs attention, opens the same controls. Ordinary inventory reads are local; only **Check now** (or the daily check) invokes
remote discovery. Development reports its local source revision and explains
that installed-device updates are unavailable.

**Update now** sends the displayed current and target revisions through
Desk's existing browser admission and CSRF boundary. It discloses the restart
and interruption of running chats before the action. The installed lifecycle
validates the checkout, source ownership, pending operations and current remote
candidate, then asks the existing systemd user manager to run a fixed transient
`pythia-agent-update.service`. That service runs only the installed command's
`update` operation with the expected revisions. No browser-supplied command,
path, unit name or environment is accepted.

The transient unit is independent of `pythia-agent.target`, allowing the existing
updater to stop and rebuild Desk. The handoff itself does not hold the lifecycle
lock; the launched `pythia update` acquires the same lock as terminal use and
rechecks the selected revisions before mutation. One fixed unit prevents parallel
Desk handoffs. Systemd holds execution and failure state; the existing lifecycle
receipt remains the durable authority. There is no new daemon, update queue,
transaction database, automatic update policy or alternative updater.

Desk polls local inventory during an attempt, including when the handoff response
is lost as Desk stops. It never retries the update mutation automatically. A
matching activated build, an idle updater, and a matching lifecycle receipt in
the `complete` phase confirm completion. Activation alone, a failed updater, a
network failure, or missing evidence from an older release does not. Polling
continues after activation until that receipt confirms completion or the updater
reports failure. After ten minutes without confirmation, the page offers a
connection retry and host recovery instructions. Once the new build is running,
**Reload Desk** loads the new browser assets.

## Rationale and consequences

This keeps fast-forward, ownership, trust, locking, preservation and failed-stopped
recovery in the established lifecycle. Dirty or changed source is refused rather
than overwritten. A failed preflight or unavailable user service manager produces
an actionable result. A failure after Desk stops can require `pythia status`,
`pythia doctor` and `pythia recover` on the host; the offline Desk cannot diagnose
that host independently.

The initial installation of this capability still requires the existing install
or rebuild path. Browser tests and deterministic lifecycle handoff tests exercise
the new seam without applying an update. A complete update initiated from an
installed Ubuntu Desk remains a separate qualification step; macOS development
is not evidence for systemd execution or recovery across host reboot.

## Rejected alternatives

Running the updater under Desk's service cgroup would terminate it when Desk
stops. An always-running update service or second transaction store would add
ownership with no demonstrated need. Checking Git remotes merely to display the
version would make navigation dependent on network access. Automatically retrying
an ambiguous start could launch a second consequential operation; status readback
is the appropriate recovery path.

## Revision (2026-09)

At the owner's request Desk now checks for updates once a day while it is
open, on load and when the window regains focus after a day, as Hermes Desktop
does; **Check now** remains. The browser records when it last checked, so a
reload or second tab does not check again. The check's answer is kept apart
from local inventory reads, which still never contact a remote. Settings ›
Updates shows the version and update status, and the navigation footer shows
one entry only while an update is ready, installing, needing a reload or
failed; it opens the same controls in a dialog. Applying an update is
unchanged.
