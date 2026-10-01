# Third-party notices

Pythia-authored source is licensed under [Apache-2.0](LICENSE). Upstream
components retain their own licenses. Current runtime dependencies are recorded
in [`runtime/versions.json`](runtime/versions.json) and the lockfiles. Below are
notices for the financial-data SDKs the bundled plugins use, and for a retired
integration, kept as a historical reference.

## Hermes Agent

Pythia uses Hermes Agent 0.21.0, release `v2026.8.31`, at commit
`29112bef099274229cadff79cdff7bf7b99c4b77`, unmodified. Hermes Agent is
licensed under MIT. Its source and license are available from the
[qualified upstream revision](https://github.com/NousResearch/hermes-agent/tree/29112bef099274229cadff79cdff7bf7b99c4b77)
and its [MIT license](https://github.com/NousResearch/hermes-agent/blob/29112bef099274229cadff79cdff7bf7b99c4b77/LICENSE).

## Basic Memory (retired integration)

Pythia previously ran Basic Memory 0.23.2 as a separate, unmodified process;
[ADR 0013](docs/decisions/0013-workspace-and-native-research-context.md) retired
that default. Basic Memory is licensed under AGPL-3.0-or-later. Its source and license are
available from the
[qualified upstream revision](https://github.com/basicmachines-co/basic-memory/tree/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048)
and its
[AGPL license](https://github.com/basicmachines-co/basic-memory/blob/c0bd87c6d5a4a58034b1d6c8c5018e443b0bd048/LICENSE).

## Financial-data SDKs

Two Node.js SDKs are production dependencies of the root `package.json`. The
runner workers of the bundled `pythia-eodhd` and `pythia-yahoo-discovery`
plugins use them, not core
([ADR 0034](docs/decisions/0034-core-and-optional-features.md) moved EODHD out
of core). Each plugin records its own data rights.

- The EODHD Node.js SDK 1.1.0 (`eodhd`) is licensed under MIT. The qualified package
  source is commit
  [`9e3970d`](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/tree/9e3970daef47e95110e40a12ac30a31421fdd81c),
  with its
  [license in that revision](https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/LICENSE).
  The installed package is the
  [npm release](https://www.npmjs.com/package/eodhd/v/1.1.0).
- yahoo-finance2 4.0.2 is licensed under MIT. It comes from
  [npm](https://www.npmjs.com/package/yahoo-finance2/v/4.0.2) and its
  [source is public](https://github.com/gadicc/yahoo-finance2).

The SDKs' MIT licenses cover their code, not the providers' data. Users must
obtain their own EODHD access and comply with each provider's terms and
data-redistribution rights; Yahoo's terms are recorded in
[the Yahoo discovery plugin](runtime/managed/plugins/yahoo-discovery/README.md#provider-terms).
Pythia does not commit provider responses.

## EdgarTools (retired core integration)

[ADR 0034](docs/decisions/0034-core-and-optional-features.md) removed this SDK
from core. Later connectors must record their own dependency and data rights.

- EdgarTools 5.56.0 is licensed under MIT. The previously installed package came from
  [PyPI](https://pypi.org/project/edgartools/5.56.0/); its
  [license is published upstream](https://github.com/dgunning/edgartools/blob/v5.56.0/LICENSE.txt).
  Access to SEC systems remains subject to the SEC's access policies.

Current artifact URLs, hashes, source relationships and license links are
recorded in `runtime/versions.json`. JavaScript and Python lockfiles record the
wider dependency graph; those dependencies retain their upstream licenses.
