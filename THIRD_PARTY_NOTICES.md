# Third-party notices

Pythia-authored source is licensed under [Apache-2.0](LICENSE). Pythia installs
the following reviewed runtime components from exact upstream artifacts; each
component remains under its own license.

## Hermes Agent

Pythia uses Hermes Agent 0.21.0, release `v2026.8.31`, at commit
`29112bef099274229cadff79cdff7bf7b99c4b77`, unmodified. Hermes Agent is
licensed under MIT. Its source and license are available from the
[qualified upstream revision](https://github.com/NousResearch/hermes-agent/tree/29112bef099274229cadff79cdff7bf7b99c4b77)
and its [MIT license](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/LICENSE).

## Basic Memory

Pythia runs Basic Memory 0.23.2 as a separate, unmodified process. Basic Memory
is licensed under AGPL-3.0-or-later. Its corresponding source and license are
available from the
[qualified upstream revision](https://github.com/basicmachines-co/basic-memory/tree/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048)
and its
[AGPL license](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/LICENSE).

## Financial-data SDKs

- EdgarTools 5.56.0 is licensed under MIT. The installed package comes from
  [PyPI](https://pypi.org/project/edgartools/5.56.0/); its
  [license is published upstream](https://github.com/dgunning/edgartools/blob/v5.56.0/LICENSE.txt).
- The EODHD Node.js SDK 1.1.0 is licensed under MIT. The qualified package
  source is commit
  [`9e3970d`](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/tree/9e3970daef47e95110e40a12ac30a31421fdd81c),
  with its
  [license in that revision](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/LICENSE).

The EODHD SDK's MIT license covers the SDK code, not EODHD market data. Users
must obtain their own EODHD access and comply with the provider's terms and
data-redistribution rights. Pythia does not commit provider responses. Access
to SEC systems likewise remains subject to the SEC's access policies.

Exact artifact URLs, hashes, source relationships, and license links are
recorded in [`runtime/versions.json`](runtime/versions.json). JavaScript and
Python lockfiles record the wider dependency graph; those dependencies retain
their upstream licenses.
