# First-release predecessor fixture

`technical-preview-a.json` derives a local-only predecessor from the current
public source snapshot. It does not contain a second source tree or a release
key.

The predecessor is a plausible earlier technical preview: Hermes, Desk, SEC
research, and investment memory remain available, while EODHD has no managed
skill guidance yet and Desk uses a shorter restart delay. Both snapshots use
the current native Workspace storage model; legacy note/config files remain
preservation fixtures. The final snapshot adds the skill and current restart
delay. The explicit Basic Memory transition has separate preservation tests.

Tests always rebuild both snapshots from Git-trackable files. This keeps the
fixture valid when later public documentation changes and lets the final tree
be compared byte-for-byte and mode-for-mode with the source checkout. Tags and
trust identities used by tests are ephemeral and never enter either snapshot.
