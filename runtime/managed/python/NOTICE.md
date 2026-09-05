# Runtime dependency notices

Pythia installs these dependencies unmodified from their recorded upstream
artifacts. Their own licenses apply:

- Hermes Agent 0.21.0 at commit `29112bef099274229cadff79cdff7bf7b99c4b77`
  — MIT, <https://github.com/NousResearch/hermes-agent>.
- Basic Memory 0.23.2 — AGPL-3.0-or-later,
  <https://github.com/basicmachines-co/basic-memory/tree/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048>.
- EdgarTools 5.56.0 — MIT, <https://pypi.org/project/edgartools/5.56.0/>.

Basic Memory runs as a separate process. Pythia does not copy or modify its
source and links to the exact corresponding source above.

Hermes intentionally refuses wheel or sdist installation. Pythia verifies and
extracts the recorded source archive, then uses that source's own committed
`uv.lock` with `uv sync --frozen --extra all`. This is Hermes's curated native
install set, not `--all-extras`; it supplies the API Server adapter without
enabling unwanted tools or platforms. Hermes is never built from a moving
branch or added to the Basic Memory/EdgarTools environment.
