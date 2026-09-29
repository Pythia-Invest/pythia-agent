# 0044: Product direction: mandate-driven agents, a decision ledger, and a pluggable backbone

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
- **The identity question flood is a single-source artefact.** A full claims
  build over EU and United States reference data raised 11,965 open identity
  questions. Only one source, ESMA FIRDS, emitted claims. SEC, GLEIF and
  OpenFIGI facts were written into the reference store directly, bypassing the
  resolver.
  - 86% of the questions were missing evidence that another open source
    states.
  - About 8% were errors in a single source, mostly stale identifiers after
    corporate actions.
  - Only 47 (0.4%) needed judgment, all of them the question of which of two
    real listings is primary.
  - In an independent check of twelve cases against primary sources, none
    needed human judgment. In three, the correct answer was not among the
    question's candidates.
- **Reference sources stopped being plugins without a decision.** An early
  design let reference sources emit claims at runtime. A security review found
  that any plugin could label its rows as reference data. The fix removed
  reference claims from plugins entirely, and the separate builder became the
  only writer of reference data. Later documents described that split without
  deciding it.
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
7. **Local workspace, pluggable backbone.**
   - Research, strategies, credentials, portfolios and ledgers stay on the
     investor's machine.
   - Core is the protocol: subject kinds, identifier rules, the claim format,
     a deterministic resolver over the claims of all enabled plugins, open
     versioned default rules, and small shared registries such as venue codes,
     canonical crypto assets and plugin identifier namespaces.
   - Every source is a plugin that emits claims, including the official
     registers (ESMA FIRDS, GLEIF, SEC, ISO 10383, OpenFIGI). Plugins never
     reconcile.
   - Each plugin runs in the mode its source suits: direct (built on the
     investor's machine), prebuilt (a signed cache of the same plugin's
     output, which anyone may publish where the source's terms allow and the
     user chooses to trust), or on demand.
   - Prebuilt caches and datasets are delivered as downloads, never as a live
     query service, so no service learns what a user researches.
   - Licensed provider data is never redistributed.
   - There is no central authority.
8. **Conflict handling.**
   - The resolver first combines the evidence of all enabled plugins with
     deterministic rules. That settles missing evidence and known source
     errors.
   - The default rules (definitions and precedence) are published, versioned,
     changelogged and forkable, and users may override them locally.
     - Overrides that affect only display may diverge between installations.
     - Facts that a mandate reads must match where a strategy runs, so a
       shared strategy records the rule version it was evaluated under.
   - Genuine judgment cases are settled by answer lists, which are plugins:
     Pythia's default list, lists from others, or the user's own. When trusted
     lists disagree, the answer stays unknown.
   - A user's own unmatched records are resolved lazily on their machine, with
     one-click confirmation of a suggested match.
   - Differing values are shown side by side, as ADR 0040 already requires.
   - Source drift is the plugin maintainer's responsibility.
   - Local fixes may be shared with a list or plugin maintainer by opt-in per
     fix, sending identifiers and reasoning only.
   - When a user's own vendor disagrees with the default evidence, the default
     holds, the disagreement is shown, and the user may override it locally.
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
   - **Identifiers come from identifiers, not sources.** Any enabled plugin
     that supplies the key identifier yields the same subject identifier.
   - **Default reference plugins are preinstalled and enabled, never
     mandatory.** Disabling one reduces the universe it covers. Where it
     supplies the identifier that keys a segment, that segment uses temporary
     identifiers. For example, United States and Canadian securities are keyed
     by share-class FIGI because their ISINs are licensed.
   - **Enabling a source later re-keys temporary identifiers through aliases**
     derived from stable identifiers, never from reusable tickers alone.
   - **Shared artefacts** (strategy packages, ledger exports) carry every known
     identifier per subject and the default-rule version, and the receiving
     installation resolves them with its own plugins.
   - **Paused until a strategy universe reaches a gap or a second user
     arrives:** new reference plugins and further source audits.
10. **Plugin trust levels.** Display, suggest identity, and confirm identity.
    - **Display** covers showing data with its source and adding subjects in
      the plugin's own domain. It needs declared coverage, terms and
      identifier scheme.
    - **Suggest identity** covers proposing facts about subjects other sources
      also describe.
    - **Confirm identity** covers establishing those facts without review, and
      requires the full onboarding audit and sign-off.

    A user's own licensed vendor is usable at the display level.
    - What a plugin's claims can establish is bounded by claim type and trust
      level; a plugin cannot raise it by labelling its claims.
    - Trust attaches to a signed or hashed plugin release, not to its name.
    - Trust levels bound data, not code. Isolating untrusted plugin code is
      required before an open marketplace.
11. **Extension model.** Builders customise through files and plugins, and the
    core stays upstream and updatable.
    - **Files:** strategies, mandates, skills, prompts and agent roles.
    - **Plugins:** sources, account readers, datasets, widgets, schedules and
      monitors.
12. **Sustainability.**
    - The application is open source and free to run. Its default plugins can
      build their data directly, and a free, regularly updated prebuilt cache
      of the default plugins is available.
    - Optional paid services sell convenience, never authority:
      - frequent prebuilt updates;
      - a maintained answer list;
      - datasets built from open sources;
      - hosted workspaces;
      - later, strategy packages after legal review.

      Everything they provide can also be built or answered locally.
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
- **Evidence, not authority.** The measured conflicts are overwhelmingly
  missing evidence and single-source errors that the combined evidence of
  standard open plugins settles deterministically.
  - A central curator is therefore unnecessary for correctness, and it would
    work against a plugin ecosystem.
  - The genuine remainder is small and definitional, and optional answer lists
    handle it without making any party mandatory.
  - Prebuilt caches keep the convenience of central building without its
    authority.
  - Downloads, rather than live queries, preserve privacy: what an investor
    researches is their edge.
- **Scope identity to what the loop needs.** The identity backbone is what lets
  many plugins connect. Further breadth adds less than the missing engine
  does.

## Consequences

This ADR sets direction. Each component (ledger, mandates, jobs, approvals and
execution, reference plugins with prebuilt caches and answer lists, plugin platform interface) receives
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
  - **Question delivery.** Most questions disappear once all default plugins
    emit claims. Identity questions reach a device only for subjects it
    touches, and genuine judgment cases are answered by the answer lists the
    user trusts.
  - **Plugin-contributed subjects.** Plugins may add portable, first-class
    subjects under declared identifier schemes. Today, subjects that only a
    provider knows receive provisional, non-portable identifiers, and only the
    reference build mints chain-asset keys. The shared canonical-asset table
    remains the source of keys for widely held crypto assets, so that different
    providers agree on them.
- **[ADR 0038](0038-plugin-addressing-contract.md) "Reference sources do not
  emit".**
  - Reference sources become claim-emitting plugins again.
  - The security concern that removed them, plugins labelling their own rows as
    reference data, is addressed by bounding claims by claim type and trust
    level (ruling 10).
- **[ADR 0039](0039-local-first-reference-data-and-rights.md) "Pythia publishes
  no snapshot and operates no service" and "Model verdicts stay out of any
  release".**
  - The reference package becomes a prebuilt cache of the default plugins'
    output: optional, reproducible where sources allow, and not an authority.
  - Pythia, or anyone else, may publish such a cache over open data once the
    rights checks listed in that ADR are complete.
  - Reviewed answers ship as an optional answer list.
  - Raw model exchanges stay out of releases.
  - Provider data is still never redistributed.
- **[ADR 0042](0042-source-onboarding-standard.md) "The builder's reference
  sources are not plugins" and "verdicts stay on the device".**
  - Reference sources are plugins.
  - The trust levels in ruling 10 define what requires sign-off.
  - Reviewed answers over open data may ship as an optional answer list.
  - Gold labels on licensed data and raw model exchanges stay on the device.
- **Identifier corrections before any ledger.** Listing identifiers must use a
  listing's trading currency. The current rule uses a register field with a
  different meaning on some venues. This is corrected before any ledger or
  strategy references listing identifiers.
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
- **A central curation authority** (an earlier draft of this direction). It
  would have Pythia resolve world-level identity questions centrally, with
  maintainer approval, and ship the answers as the reference. The measurements
  above show that the question volume came from single-source claims, not from
  genuine disagreement. Central curation would make one party mandatory and
  work against the plugin model.
- **Mandatory reference plugins.** They would guarantee identical identifiers
  everywhere, but make Pythia unusable for anyone who does not want part of
  the market. Preinstalled defaults, identifier bundles in shared artefacts
  and alias-based re-keying achieve portability without the mandate.
- **Every user answers world-level questions.** It would make every user a
  data curator. Answer lists remove the need.
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
