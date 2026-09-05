# 0001: Public source and ownership authority

Pythia Agent starts with fresh public history. This repository is the
implementation authority for the product.

The repository is a single monorepo. Its public source includes product code
and development material, while runtime and model-visible consumers use
explicit allowlists rather than a separate release tree. This keeps one
understandable source of change without treating all checked-in files as
runtime content.

Versioned Pythia capabilities and their dependency locks are managed. Seed
defaults are created once; credentials, configuration, sessions, knowledge,
memory, local extensions, and capability choices remain user-owned.

Hermes-native local extensions remain the extension seam, including native
same-name precedence. Pythia will not duplicate that behavior with a separate
registry or source projection.
