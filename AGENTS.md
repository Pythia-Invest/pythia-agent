# Pythia Agent contributor guidance

Pythia Agent is a local investment-research companion built around the exact,
unmodified Hermes runtime described in `runtime/contracts/`. Keep the product
simple and local: do not add another agent loop, capability registry, control
plane, cloud dependency, or globally installed Hermes prerequisite.

Before changing code, read `docs/product.md`,
`docs/architecture/ownership.md`, and the nearest nested `AGENTS.md`. Read
`.agents/change-validation.md` for proportionate verification and matching
`.agents/rules/*.md` for cross-cutting guidance. Repository-builder workflows
live in `.agents/skills/`.

Ordinary development is direct: inspect the relevant owner, make the scoped
change, verify it, and report evidence. Planning and test-plan workflows are
explicit-only; an existing plan or a request to continue does not start one.

Build for users, not the contributor's machine. Keep personal paths, accounts,
hostnames, and preferences in local configuration. Generalize a demonstrated
need through the smallest supported capability, not speculative infrastructure.
Distinguish product invariants, configurable defaults, and user-owned choices.

Read additional guidance by the surface being changed:

| Work | Read first |
| --- | --- |
| Model-visible text, including skills, tool descriptions and builder rules | [Prompting guidance](docs/prompting.md) and [instruction rule](.agents/rules/agent-instruction-design.md) |
| Platform, browser or hosting behavior | [Supported environments](docs/support.md) and [hosting](docs/hosting.md) |
| Settings, credentials, lifecycle or updates | [Credential custody](docs/architecture/credential-custody.md) and [development](docs/development.md) |
| Tests | [Test allocation](.agents/testing.md) |

Use the pinned dependency's documented native surface; inspect its relevant
source/types before adapting it. If evidence challenges a decided boundary,
explain the conflict and ask before changing that decision. Keep durable docs
current; historical experiments are evidence, not competing instructions.

Keep private working records under ignored `.private/plans/<branch>/`. Before
material work is complete, distill every accepted product or architecture
decision into public documentation or an ADR under `docs/decisions/`, including
its context, ruling, rationale, consequences, and relevant rejected
alternatives. The public repository must remain understandable without the
private record.

Builder instructions are public source but are not ordinary Pythia runtime
context. Startup, installation, and runtime discovery must not automatically
inject this file or `.agents/` into Hermes. Explicit, user-approved source
maintenance may read them like any other source file. Runtime inputs remain
role-scoped allowlists; the seeded workspace `AGENTS.md` is separate native
investor context and must never be projected as builder guidance.

Do not commit credentials, investment records, provider responses, generated
model output, or device state. Preserve unrelated changes. Do not commit, push,
activate hooks, write external services, or run real providers unless the user
explicitly authorizes that action.

Ask before changing credentials, exposing a listener, starting long-lived
services, or deleting user data. Authorization is specific to the requested
target and action; preserve other stacks and services. Enforce mechanical
security boundaries in code, not by adding stronger prompt wording.
