# Stable release verification

Stable Pythia releases are annotated Git tags signed with SSH keys. The minimum
production baseline is [Ubuntu 24.04's system Git
2.43.0](https://packages.ubuntu.com/noble/git); SSH signing is native there and
needs no GPG keyring. Preview is an explicit `main` channel and is
never presented as signed stable.

## Preview source selection and updating

Git-based preview activation and automatic updating are separate operations.
An explicit install or rebuild prepares exactly the files in the checkout the
user selected, including any branch, tag, detached commit, or uncommitted
change. It does not fetch, switch refs, merge, reset, stash, or require a
qualification receipt. Contributor checks remain evidence, not installation
eligibility.

The routine preview updater alone follows `origin/main`. Before and immediately
before mutation it requires the installed checkout identity, a clean and
conflict-free index/worktree, unchanged `HEAD`, and fast-forward ancestry. A
local fork or dirty tree stops automatic updating for manual reconciliation;
it does not prevent its owner from explicitly rebuilding the current source.
Installed metadata records both the base revision and truthful local-source
status and never labels dirty source pristine, signed, or automatically
update-safe.

## Installed activation and interruption ordering

Every update or explicit installed rebuild uses the existing lifecycle lock
and transaction store. For an already installed service, the ordering is:

1. record the selected source and current enablement in the transaction;
2. disable the Pythia target and read back that boot startup is disabled;
3. stop the target and read back that its units are inactive;
4. prepare locked dependencies before compiling any candidate code, then
   refresh the managed plugin, generated environments, and unit files;
5. reload the user manager and trial-start the target while it remains
   disabled;
6. verify exact source, owned unit fragments/processes, Hermes, Basic Memory,
   and Desk health; and
7. enable the already healthy target, read back enablement, and only then mark
   the transaction complete.

`systemctl --user stop` alone is not durable boot inhibition: an enabled target
returns after reboot. Any failure after disablement attempts disable-and-stop
again and records either `stopped` or `stop-unconfirmed`; it never restores
enablement for an unverified candidate. Recovery of every incomplete phase,
including interruption during trial start or immediately after enablement,
first disables and stops the target before resuming or re-verifying the exact
recorded candidate. This is deterministic lifecycle behavior, not proof of a
real reboot. Clean Ubuntu systemd/linger/reboot evidence remains a separate
qualification gate.

The public preview has one fixed, distinct host identity: user units use the
`pythia-agent-*` namespace and `pythia-agent.target`; the native Hermes gateway
uses loopback port `8645`, while Basic Memory and Desk retain `8643` and `8644`.
These names and ports coexist with the retained lab and are not a configurable
instance registry. Install and doctor must refuse a foreign file, process, or
listener at any owned destination rather than overwrite or adopt it.

The installer puts Pythia's pinned Node directory on `PATH` before invoking
Corepack or pnpm. The same source/copy/build sequence is used by install,
update, and explicit rebuild: native frozen dependency sync first, then the
managed EODHD runner and production Desk builds, then copied-plugin validation
and activation. No caller compiles against a predecessor environment or builds
the runner a second time.

## Exact rule

A stable name must match exactly
`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`. Pre-release/build
suffixes, abbreviated versions, branch names, remote expressions, and other
refs are rejected. After an explicit tag fetch, the updater owned by the
currently installed revision performs the equivalent of:

```text
git cat-file -t refs/tags/<tag>
git -c gpg.format=ssh \
    -c gpg.ssh.allowedSignersFile=<installed-allowed-signers-file> \
    verify-tag refs/tags/<tag>
git rev-parse --verify refs/tags/<tag>^{commit}
git rev-parse --verify HEAD^{commit}
```

The first output must be exactly `tag`, excluding unsigned lightweight tags.
`verify-tag` must exit zero; the updater does not parse localized success text.
The peeled tag commit must be the selected install/update commit, and stable
first install additionally requires `HEAD` to equal it exactly. A missing ref,
invalid name, wrong object type, bad signature, expired/revoked local policy,
or signer not matched by the allowed-signers file fails closed before checkout,
build, dependency execution, hooks, or code from the candidate revision.

The allowed-signers file pins approved principal/key pairs. The lifecycle code
does not trust GitHub's signature badge, a key embedded only in the fetched
tag, `main`, or the candidate revision's updater. A disposable probe on Git
2.50.1 proved exit 0 for a trusted signed annotated tag and exit 1 for both an
unsigned lightweight tag and a valid signature from an unknown signer. Git's
format and trust-file semantics are documented by
[`git-config`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgformat) and
[`git-verify-tag`](https://git-scm.com/docs/git-verify-tag).

## Bootstrap and rotation

On update, the running installed revision supplies both verification code and
the trust root, verifies the fetched tag, and only then permits new code to
execute. A trust-root rotation release must be signed by a signer already
trusted by its predecessor and may add the next signer. Only a later release,
again signed under the then-installed trust root, may remove the old signer.
Unknown signers never trigger automatic key retrieval or trust.

The first clone has no already-installed independent trust root. A signer file
obtained from the same checkout can detect later substitution but cannot prove
who published that first checkout; this is trust on first use. The installer
must show the selected tag, signer fingerprint, and this limitation, and offer
an out-of-band published fingerprint when one exists. It must not describe a
self-contained checkout as independently verified. Establishing a stronger
bootstrap (for example, an independently distributed key) is a release-owner
decision, not an updater inference.
