# Runtime dependency notices

Pythia installs these dependencies unmodified from their recorded upstream
artifacts. Their own licenses apply:

- Hermes Agent 0.21.0 at commit `29112bef099274229cadff79cdff7bf7b99c4b77`
  — MIT, <https://github.com/NousResearch/hermes-agent>.
- EdgarTools 5.56.0 — MIT, <https://pypi.org/project/edgartools/5.56.0/>.

Hermes intentionally refuses wheel or sdist installation. Pythia verifies and
extracts the recorded source archive, then uses that source's own committed
`uv.lock` with `uv sync --frozen --extra all`. This is Hermes's curated native
install set, not `--all-extras`; it supplies the API Server adapter without
enabling unwanted tools or platforms. Hermes is never built from a moving
branch or added to the managed provider environment.
