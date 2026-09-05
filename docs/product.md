# Pythia Agent

Pythia Agent is a local investment-research companion. It helps an investor
investigate a company or question, keep useful working knowledge in view, and
return to the reasoning behind an investment decision. The investor keeps
judgment and capital decisions.

The product begins with a local Desk and one manager. The manager can use
managed research capabilities and preserve useful work, while the investor can
inspect, edit, or reject consequential changes. Pythia is not a trading
system, investment adviser, or substitute for independent judgment.

This repository is Pythia's public monorepo and implementation authority. It
contains product source, the managed local runtime, tests, and development
tools. A file being public source does not make it runtime content: each
service, build, installer, plugin copy, Hermes scan root, and model input has
an explicit allowlist of what it may consume.

Pythia uses the unmodified Hermes Agent release `v2026.8.31` at
`29112bef099274229cadff79cdff7bf7b99c4b77` as a Pythia-owned runtime
dependency. Frozen preparation installs it as part of an explicit source
activation or update. It is neither patched, vendored, submoduled, nor expected
to be a global prerequisite. This narrow seam keeps Hermes replaceable.

## Research principles

Pythia serves investors with different strategies and operating environments.
An opinionated default is a starting point, not a claim that every investor
shares the same judgment. Keep supported user choices distinct from product
invariants and preserve them across updates. Personal providers, hosting,
accounts and paths are configuration, not product constants. Add the smallest
capability needed by a demonstrated use case; flexibility does not require a
new framework for hypothetical future users.

Pythia's starter workspace carries a few durable habits rather than a rigid
investment process:

- name the source and relevant date for material facts;
- keep sourced evidence distinct from estimates, interpretation, and judgment;
- search existing notes before creating another durable note on the same
  subject; and
- keep durable research in user-readable Markdown so it remains inspectable
  without the agent or its derived index.

These principles were retained because they make later review and correction
easier. A larger inherited framework, private lab record, or prescribed stock-
selection workflow is not required to understand or maintain the product.

Pythia-authored source is available under Apache-2.0. Third-party components
remain subject to their own licenses and notices.
