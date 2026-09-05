# Dependency/build-order fixture

This fixture is entirely local and provider-free. `contract-a` represents an
already installed predecessor dependency. `package-b.json` and
`pnpm-lock-b.yaml` select `contract-b`, whose declaration is required by the
candidate TypeScript source.

The acceptance test keeps A in `node_modules`, switches both candidate source
inputs to B, proves the real compiler rejects the predecessor environment,
runs Pythia's shared preparation caller, and then proves its real frozen
offline pnpm install plus TypeScript build and Node consume B. The fixture
stubs only the separately qualified Hermes/uv preparation boundaries. Neither
the repository lockfile nor an external package is changed.
