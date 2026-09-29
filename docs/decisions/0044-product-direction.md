# 0044: Product direction: mandate-driven agents, a decision ledger, and local workspaces with central truth

## Context

Pythia began as a local research companion. Much of the recent work built the
foundation for reliable data: the identity backbone
([ADR 0037](0037-identity-backbone.md)), source selection
([ADR 0040](0040-data-concepts-and-agent-tools.md)), reference data
([ADR 0039](0039-local-first-reference-data-and-rights.md)) and source
onboarding ([ADR 0042](0042-source-onboarding-standard.md)).

In September 2026 the project clarified its goal. Pythia should let investors
work with AI agents that research continuously, decide within an explicit
mandate, and eventually help develop new strategies. The first users are
technically comfortable investors who self-host. A hosted offering for
investment teams, and sharing proven strategies, follow later.

An architecture review of the umbrella branch against that goal found the
following:

- **The engine has no home.** Nothing represents a mandate, a decision record,
  forecasts, a paper portfolio, portfolio state, order approval, or work that
  runs without an open conversation.
- **Evaluation is the hard problem.** Historical backtests of LLM judgment are
  contaminated by training data
  ([Lopez-Lira, Tang and Zhu, 2025](https://arxiv.org/abs/2504.14765);
  [FINSABER, 2025](https://arxiv.org/abs/2505.07078)). Returns alone take many
  years to establish modest skill
  ([Bailey and López de Prado](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)).
- **An approval the agent can reach is not an approval.** The agent's terminal
  runs as the same user as the application, so an approval step that the agent
  could reach would not be a real boundary.
- **Pythia's state and plugins depend on Hermes internals.** This makes the
  harness harder to replace, and it gives the future engine no Pythia-owned
  home.
- **Identity resolution on every device imposes a curator's work on every
  user.** A reference build can raise more than ten thousand world-level
  questions that have the same answer everywhere.
- **Some effort goes to breadth the goal does not yet need.** That includes
  additional reference sources and audits.

## Ruling

1. **Direction.** Pythia is a self-hosted workbench for mandate-driven
   investment agents: research, decisions within limits, a verifiable forward
   record, and owner-approved execution. [Vision](../vision.md) is the public
   description of this direction.
2. **Audience order.** Builder-investors, who self-host and customise, come
   first. Hosted workspaces and team offerings follow. Their form is decided
   with teams once agent strategies have a track record.
3. **The decision ledger.** Every decision, including a deliberate decision to
   take no action, is recorded append-only and hash-chained, with a daily
   external timestamp.
   - Each actionable decision carries two to five resolvable forecasts and
     references to its evidence.
   - Evidence is stored as references, never as copies of licensed data.
   - Forward records and scored forecasts are the evidence of skill.
     Backtests serve rule-based strategies and are labelled with their
     biases. Replays of agent judgment are never evidence.
4. **Mandates.** A strategy is a shareable method. A mandate is an investor
   adopting it with explicit limits. Capital authorisation is a separate act.
   - A running mandate has a small machine-checked limits file next to its
     prose.
   - Deterministic code checks every decision against the approved limits.
   - Exploratory strategies remain free-form.
5. **Execution boundary.**
   - Agents propose; Pythia sizes and checks orders.
   - Execution is never model-callable or widget-invokable.
   - Approval is proven by the owner through a channel the agent cannot reach.
     The first form is placing a drafted order in the broker's own application.
   - Broker-side limits (trade-only credentials, dedicated sub-accounts) are
     the backstop.
   - Agent code execution is sandboxed before any live trading credential is
     connected.
   - Pythia executes only on the owner's own accounts.
6. **Engine ownership.** Pythia owns mandates, the ledger, portfolio, jobs,
   order tickets and approvals, in stores under Pythia's own data directory.
   - The agent harness (currently Hermes) runs agent turns behind a single
     adapter.
   - Plugins use a small Pythia platform interface and do not import harness
     internals.
   - The engine starts in the existing backend process. It moves to its own
     process at a concrete trigger: live automated execution with isolated
     credentials, a native client, a harness replacement, or a hosted
     deployment.
7. **Local workspace, central truth.**
   - Research, strategies, credentials, portfolios and ledgers stay on the
     investor's machine.
   - World-level identity answers, vendor symbol mappings for widely used
     vendors, and optional datasets built from open sources are curated
     centrally and delivered as signed downloads. Pythia's services do not
     receive users' queries.
   - Licensed provider data is never redistributed.
8. **Conflict handling.**
   - World identity conflicts are resolved centrally at build time, by rules,
     typed claims and AI-assisted review, with maintainer approval.
   - A user's own unmatched records are resolved lazily on their machine, with
     one-click confirmation of a suggested match.
   - Differing values are shown side by side, as ADR 0040 already requires.
   - Source drift is the plugin maintainer's responsibility.
   - Local fixes may be contributed upstream by opt-in per fix, sending
     identifiers and reasoning only.
   - When a user's own vendor disagrees with the reference, the reference is
     the default and the user may override it locally.
9. **Identity scope and contributions.**
   - **Kept:** the four-level backbone and its relations, today's coverage,
     permanent identifiers (aliases, successors, and no identifier ever
     disappearing), and holdings-first subjects for records that cannot be
     matched.
   - **Core owns the rules, plugins contribute the contents.** Core defines a
     small set of subject kinds, the identifier rules, relations and matching.
   - **Plugins may add subjects** within those kinds, under open or native
     identifiers through an identifier scheme they declare (for example
     on-chain identifiers for a DeFi ecosystem's protocols, pools and tokens,
     or ISINs for over-the-counter stocks).
     - Such subjects are portable and first-class: they have the same
       identifier on every installation with that plugin.
     - A plugin is the authority for its own domain.
     - Links to shared subjects are made by identifier agreement or suggested
       for review.
   - **New kinds** are a rare core addition.
   - **Paused until a strategy universe reaches a gap or a second user
     arrives:** new central reference sources and further source audits.
10. **Plugin trust levels.** Display, suggest identity, and confirm identity.
    - **Display** covers showing data with its source and adding subjects in
      the plugin's own domain. It needs declared coverage, terms and
      identifier scheme.
    - **Suggest identity** covers proposing facts about subjects other sources
      also describe.
    - **Confirm identity** covers establishing those facts without review, and
      requires the full onboarding audit and sign-off.

    A user's own licensed vendor is usable at the display level.
11. **Extension model.** Builders customise through files and plugins, and the
    core stays upstream and updatable.
    - **Files:** strategies, mandates, skills, prompts and agent roles.
    - **Plugins:** sources, account readers, datasets, widgets, schedules and
      monitors.
12. **Sustainability.**
    - The application is open source and free to run, with a free, regularly
      updated reference snapshot.
    - Optional paid services cover what is shared and costly to operate:
      curated data updates and datasets built from open sources, hosted
      workspaces, and later strategy packages after legal review.
    - Model access stays bring-your-own by default.

## Rationale

- **Trust is the constraint.** Agents can already do analyst-scale work. What
  is missing is a way to know whether their judgment is good. A forward,
  verifiable record with scored forecasts answers that. It cannot be created
  after the fact, so it must exist from the first mandate run.
- **Limits in prose are advisory.** Checking them in code turns them into a
  boundary, consistent with enforcing security boundaries in code rather than
  in prompts.
- **Keeping execution out of the agent's reach** is the only boundary that
  holds against prompt injection through documents and news, while agent
  sandboxing is still deferred.
- **Owning the engine's state keeps it portable.** Pythia-owned state survives
  a harness replacement, a native client and hosted deployments. Starting
  in-process avoids new infrastructure until a trigger justifies it.
- **Resolve shared facts once.** Resolving world-level facts once keeps the
  local workspace, and its privacy and control, without turning every user
  into a data curator. Delivering curated data as downloads preserves privacy:
  what an investor researches is their edge.
- **Scope identity to what the loop needs.** The identity backbone is what lets
  many plugins connect. Further breadth adds less than the missing engine
  does.

## Consequences

This ADR sets direction. Each component (ledger, mandates, jobs, approvals and
execution, curated reference distribution, plugin platform interface) receives
its own implementing ADR or architecture document when it is built.

It amends the following rulings:

- **[Product](../product.md) "Pythia is not a trading system".** Replaced:
  Pythia is not an investment adviser. It acts on an owner's own accounts only
  with that owner's explicit approval.
- **[ADR 0013](0013-workspace-and-native-research-context.md) "No
  investment-case schema".** A running mandate gets a small machine-checked
  limits file. Everything else stays schema-free.
- **[ADR 0030](0030-coordinated-reads-and-live-updates.md) "no new durable
  scheduler".** Pythia-owned jobs run mandate and event-driven research. Live
  subscriptions are unchanged.
- **[ADR 0037](0037-identity-backbone.md).**
  - **"Nothing triggers the agent."** Jobs may trigger agent work.
  - **Question delivery.** Identity questions reach a device only for subjects
    it touches; world-level questions are answered centrally.
  - **Plugin-contributed subjects.** Plugins may add portable, first-class
    subjects under declared identifier schemes. Today, subjects that only a
    provider knows receive provisional, non-portable identifiers, and only the
    reference build mints chain-asset keys. The shared canonical-asset table
    remains the source of keys for widely held crypto assets, so that different
    providers agree on them.
- **[ADR 0039](0039-local-first-reference-data-and-rights.md) "Pythia publishes
  no snapshot and operates no service" and "Model verdicts stay out of any
  release".**
  - Pythia may publish a signed reference package over open data, including
    reviewed curated answers, once the rights checks listed in that ADR are
    complete.
  - Raw model exchanges stay out of releases.
  - Provider data is still never redistributed.
- **[ADR 0042](0042-source-onboarding-standard.md) "verdicts stay on the
  device".**
  - Reviewed curated answers over open data may ship in the reference package.
  - Gold labels on licensed data and raw model exchanges stay on the device.
  - The trust levels in ruling 10 define what requires sign-off.
- **The deferral of agent sandboxing** ends before the first live trading
  credential is connected.
- **Hermes-native permissions** continue to govern reads. Approval of orders is
  owned by Pythia.

## Rejected alternatives

- **A fully hosted service now, with licensed data.** It would make the product
  simpler for teams. But it requires licensing and redistributing market data
  before there is a product, removes the privacy of what users research, makes
  a customisable many-agent workbench expensive to operate, and conflicts with
  local control. It stays open as a later option: a hosted workspace running
  the same software.
- **Fully local data resolution.** It would give each installation its own
  reference build and its own world-level questions, and it would make every
  user a data curator.
- **Only the central reference may create subjects.** It would make every new
  domain wait for core and central curation, contradicting the plugin model:
  exotic domains such as a single DeFi ecosystem or a niche market would never
  be first-class.
- **Backtest-first evaluation of agent judgment.** It is contaminated by
  training data and misleading.
- **Autonomous execution without per-trade approval.** Deferred until a
  sustained record exists and an explicit decision is made.
- **Building the engine inside the agent harness.** That would deepen the
  dependency on harness internals and lose portability.
- **Continuing identity breadth before the engine.** It improves coverage that
  current strategies do not need, while the record that cannot be created later
  does not exist.
- **Live query data services.** They would reveal what users research.
