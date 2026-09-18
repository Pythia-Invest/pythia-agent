# Hermes runtime preparation

This directory contains preparation metadata, not vendored runtime code.
Pythia prepares Hermes unmodified from its recorded upstream artifact:

- Hermes Agent 0.21.0 at commit `29112bef099274229cadff79cdff7bf7b99c4b77`
  — MIT, <https://github.com/NousResearch/hermes-agent>.

Hermes intentionally refuses wheel or sdist installation. Pythia verifies and
extracts the recorded source archive, then uses that source's own committed
`uv.lock` with `uv sync --frozen --extra all`. This is Hermes's curated native
install set, not `--all-extras`; it supplies the API Server adapter without
enabling unwanted tools or platforms. Hermes is never built from a moving
branch. Core lifecycle checks use its prepared Python interpreter without
installing additional packages or a separate environment. Optional research
libraries belong to their own feature packages.

The retired EdgarTools integration is recorded in the repository's third-party
notices. Existing old environments are preserved for explicit legacy transitions.
