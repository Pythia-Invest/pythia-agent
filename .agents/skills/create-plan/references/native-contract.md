# Planning a native contract

Use this when an external SDK, API, framework, wire protocol, or moving baseline
materially shapes the implementation.

Establish the exact dependency version and owner, operation-specific inputs and
results, optional fields, partial-failure and cancellation behavior, and an
authoritative evidence source: installed source/types, official documentation,
or a bounded approved probe. Prefer the native path and list only Pythia-owned
transformations required by an accepted decision or mechanical boundary.

Do not infer one operation from another, recreate a dependency's whole schema,
or let a hand-authored fixture define the contract. Schedule qualification
before dependent work when authoritative evidence is missing.
