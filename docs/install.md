# Installation

Pythia's installed technical preview supports Ubuntu x86-64. Development on
macOS and Ubuntu uses the foreground flow in [development.md](development.md)
and does not need this installer.

## Before installing

The host needs Git 2.43 or newer plus `curl`, `tar`, `xz`, `sha256sum`,
`flock`, `ssh-keygen`, systemd user services, and `loginctl`. The installer
downloads exact Node, uv, Python, Hermes, Basic Memory, EdgarTools, and
JavaScript artifacts and verifies their recorded versions or hashes. It puts
its owned Node directory on `PATH` before invoking Corepack or pnpm.

Clone or otherwise prepare a checkout you trust. Pythia does not offer a
shell-over-the-network command.

## Install the technical preview

Preview installation uses the checked-out source exactly as it is. The user may
choose `main`, another branch, a tag, a detached commit, or uncommitted changes;
installation does not fetch, switch, reconcile, or qualify the selected Git
source.

```sh
git clone https://github.com/Pythia-Invest/pythia-agent.git
cd pythia-agent
./install.sh --preview
```

The installation receipt records the available base revision and whether local
changes were present. It does not call dirty or arbitrary source signed,
pristine, or eligible for routine updates. A later explicit `pythia rebuild`
activates the checkout in the same way.

## What installation changes

The installer creates private Pythia directories under the standard XDG config,
state, data, and cache locations; installs a `pythia` command in
`~/.local/bin`; and installs these user units:

- `pythia-agent.target`
- `pythia-agent-hermes.service`
- `pythia-agent-basic-memory.service`
- `pythia-agent-desk.service`

It enables user lingering so the stack can run after logout. It does not create
a system service, install a global Hermes, or modify another Pythia/lab service.
The defaults are Hermes on `127.0.0.1:8645`, Basic Memory on
`127.0.0.1:8643`, and Desk at <http://127.0.0.1:8644>.

Managed plugin files are copied into the native Hermes profile after locked
dependencies are prepared. Profile, SOUL, workspace, and knowledge defaults
are created only as part of the first initialization transaction; later
installation, update, rebuild, and refresh operations preserve the resulting
user-owned files and native capability choices.

If `~/.local/bin` is not on `PATH`, add it before using the lifecycle command:

```sh
pythia status
pythia doctor
pythia auth openai-codex
```

Model credentials use Hermes's native OAuth store. SEC identity and EODHD token
are optional and can be entered in Desk's device settings. Stored values are
not returned to the browser after writing.

## If installation fails

Before mutating an installed candidate, Pythia disables boot startup and stops
all three services. Metadata and the completed transaction are written durably
after health verification and before final enablement. A preparation or health
failure therefore leaves the Pythia target disabled and stopped across reboot,
or reports that this state could not be confirmed.

On a first-install failure, fix the reported cause and rerun
`./install.sh --preview` from the same chosen checkout. Installation is the
owner of that incomplete transaction; `pythia recover` is only for an update
that already has installation metadata. If the `pythia` command is available,
`pythia status` and `pythia doctor` can provide additional readback. Do not
delete broad XDG directories or start individual units around the lifecycle
owner.

If the error reports an interrupted first profile initialization, recover only
the receipt-bound partial profile under the installer lifecycle lock, then
retry the same chosen-source install:

```sh
./install.sh --recover-initialization --preview
./install.sh --preview
```

Recovery refuses an intent-only or foreign receipt whose ownership is
ambiguous. It preserves the Hermes credential root, workspace, knowledge, and
all other device-owned state.

## Stable channel

Stable installation is designed for exact annotated SemVer tags verified
against an installed SSH trust root. No signer or stable release is published
yet, so the stable command deliberately remains unavailable. This does not
restrict an explicit preview install from source the user selected.

See [updates and customization](update-and-customization.md) for update,
rebuild, recovery, ownership, and uninstall behavior.
