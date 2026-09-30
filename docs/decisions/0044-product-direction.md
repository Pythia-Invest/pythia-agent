# 0044: Product direction: mandate-driven agents, a decision ledger, and extensible data

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
9. **Identity scope.**
   - **Kept:** the four-level backbone and its relations, today's coverage,
     permanent identifiers (aliases, successors, and no identifier ever
     disappearing), and holdings-first subjects for records that cannot be
     matched.
   - **Added only when a strategy needs them:** new kinds of subject.
   - **Paused until a strategy universe reaches a gap or a second user
     arrives:** new reference sources and further source audits.
10. **Plugin trust levels.** Display, suggest identity, and confirm identity.
    Only confirming identity requires the full onboarding audit and sign-off.
    A display-only plugin, including a user's own licensed vendor, needs
    declared coverage and terms only.
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
- **[ADR 0037](0037-identity-backbone.md) "nothing triggers the agent".** Jobs
  may trigger agent work. Identity questions reach a device only for subjects
  it touches; world-level questions are answered centrally.
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

## Amendment (2026-09-29): data any plugin can extend

### Context

The first version of this ADR, merged the same day, made Pythia's central
curation the path for world-level identity answers (rulings 7 to 9). Three
investigations on the 28 September 2026 reference build (EU and United States,
11,965 open identity questions) and a review of the code changed that
direction.

- **Plugins cannot extend the universe.** Subjects come only from the
  reference build and core's curated tables. Trust follows the list of bundled
  plugin names, and the builder's evidence outranks the same claim from a
  plugin. Reference sources stopped emitting claims after a security fix; ADRs
  0038 and 0042 recorded that afterwards without weighing alternatives.
- **Most identity questions are not judgment.**
  - About a fifth settled once the downloaded open sources contributed
    evidence as peers, and about half with an exchange-code table and one more
    rule (measured).
  - About a quarter concerned instruments that trade in Europe only on
    bank-internal, request-for-quote or dark venues.
  - About fifty (0.4%) needed judgment, nearly all about which of two listings
    is primary.
- **Runtime judgment helps research but does not settle records.** In a small,
  single-run test on real cases, strong models answered research questions
  well, often from memory of well-covered companies. They still chose
  differently on convention questions, and a smaller model did no better than
  the default.
- **Central maintenance is acceptable where licences allow.** The requirement
  is extensibility: any plugin can extend the universe through the same
  contract as the maintained defaults.

### Ruling

This amendment's rulings are numbered A1 to A8. They supersede rulings 7, 9
and 10, and the first and last bullets of ruling 8; the other rulings stand. It
also narrows the rationale "Resolve shared facts once" and the rejected
alternative "Fully local data resolution" to raising every world-level
question on every installation.

**A1.** **Extensible data with maintained defaults** (replaces ruling 7).
   - Research, strategies, credentials, portfolios and ledgers stay on the
     investor's machine.
   - Every plugin can introduce subjects and contribute evidence through the
     same supported contract.
   - Pythia provides maintained defaults, including open reference data, which
     users can replace or supplement. Default plugins are preinstalled, never
     mandatory.
   - Where a licence allows, a plugin's output may ship prebuilt. A prebuilt
     package has no more authority than the same plugin run locally.
   - Prebuilt data is delivered as downloads, so no service receives users'
     queries. Licensed provider data is never redistributed.

**A2.** **Combining evidence** (replaces the first and last bullets of ruling 8).
   - Rules combine the evidence of all enabled plugins. They name kinds of
     evidence and trust levels, never sources, and are published, versioned
     and overridable locally.
   - Conflicting claims are kept and marked, not deleted.
   - Where the rules do not decide, the link stays unresolved and the
     disagreement is shown. A local override makes the user's choice win on
     their installation.
   - An identity question is queued only when the instrument becomes relevant
     to a holding, a research task or an operation. An instrument's venue
     category does not make it irrelevant.
   - An agent's answer to any identity question is a suggestion and changes
     nothing until the user confirms it.

**A3.** **Identity scope and contributions** (replaces ruling 9).
   - **Kept:** the four-level backbone and its relations, today's coverage,
     permanent identifiers, and holdings-first subjects for records that
     cannot be matched.
   - **Core owns the rules, plugins contribute the contents.** Core defines a
     small set of subject kinds, the identifier rules, relations and matching.
     New kinds are a rare core addition.
   - **Introducing subjects.** A plugin may introduce portable, first-class
     subjects that no source yet covers, under its native identifier scheme or
     under open identifiers. Introducing a subject confers no authority over
     it: facts about any subject are weighed by evidence kind and trust level,
     and the absence of competing evidence never increases a plugin's
     authority.
   - **Links are made by identifier agreement at the right scope.** A shared
     issuer never makes two instruments the same; ambiguous links stay
     unresolved.
   - **Identifiers come from identifiers, not sources.** Any enabled plugin
     that supplies the same identifier yields the same subject.
   - **Disabling a default plugin** reduces identity quality or coverage, and
     Pythia shows the effect before it happens.
   - **Shared artefacts carry identifier bundles,** pin the meaning of their
     rules and declare their data requirements. The receiving installation
     leaves ambiguous matches unresolved. Separate installations need not
     reach identical new decisions. Reproducing a historical decision uses its
     selected facts, evidence references and relevant versions.
   - **Paused until a strategy universe reaches a gap or a second user
     arrives:** new reference sources and further source audits.

**A4.** **Plugin trust levels** (replaces ruling 10). There are three levels:
   display, suggest identity and confirm identity.
   - **Display** covers showing data with its source and introducing subjects
     under open or native identifiers. It needs declared coverage and terms,
     and the identifier scheme of any subjects it introduces.
   - **Confirm identity**, which establishes facts that other sources also
     describe without review, requires the full onboarding audit and sign-off.
   - **A user's own licensed vendor** is usable at the display level.
   - **Bounds and trust.** What a plugin's claims can establish is bounded by
     claim type and trust level. Trust attaches to a signed or hashed release,
     not to a plugin's name.
   - **Code isolation.** Trust levels bound data, not code. Isolating untrusted
     plugin code is required before an open marketplace.

**A5.** **Identity, evidence and choices are separate.**
   - Whether records are the same instrument requires evidence at the correct
     scope.
   - Which listing a view shows is a preference or documented default.
   - The instrument, price series, currency and fill policy of a forecast or
     paper decision are pinned when it is created. Pinning preserves the
     choice; it does not validate the facts behind it (A6).
   - What conflicting evidence means for a thesis is the agent's
     interpretation, which it explains.

**A6.** **Uncertainty and consequential operations.**
   - Recording uncertainty is allowed in research, notes and ledger entries.
   - Consequential operations need validated facts and pinned choices. These
     are simulating a fill, carrying or merging positions across corporate
     actions, checking an issuer limit, and creating an order ticket. Factual
     inputs, such as an issuer link or a split ratio, must meet the operation's
     evidence requirements. Choices, such as the listing, price series or fill
     policy, are pinned. Pinning preserves a choice and never validates a fact.
     When an input falls short, that operation is unavailable with a reason,
     and the rest of the workflow continues.
   - An unconfirmed agent interpretation never counts as a validated fact.
   - A saved interpretation keeps its evidence, scope and dependencies, and
     becomes stale when they change.

**A7.** **Reviewed answers.** Reviewed answers over open data may ship as a
   Pythia-maintained answer list, contributed at its trust level like any
   other plugin's evidence. Raw model exchanges and gold labels on licensed
   data stay on the device.

**A8.** **Open until validated:**
   - direct and prebuilt forms per reference source;
   - the exact evidence-weighing rules;
   - bitemporal claims;
   - learned source reliability;
   - subscribable answer lists beyond Pythia's own;
   - the content and pricing of paid services.

### Today

Where it is built, the code implements the first version of rulings 7 to 10,
until roadmap stage 0 lands. No package is published and no central curator
exists:

- The build's open questions are queued only when an instrument is opened,
  watched or used by the agent, and the user's answer is a local override
  ([ADR 0037](0037-identity-backbone.md), amendment "questions on touch").
  Holdings, forecasts and operations join as triggers in stage 1.
- Any plugin can introduce subjects and contribute evidence through core's
  ingest, joined by identifier at each record's own scope and introduced only
  under the key schemes its contract declares; pages show them, and a plugin's
  evidence, with no reference package ([ADR 0037](0037-identity-backbone.md),
  amendments "device subjects" and "ingest"). Reading a plugin's catalogue
  (`identity-sync`) and looking one identifier up (`identity-lookup`) are Desk
  operations with no scheduler; the Desk controls that start them land with
  W3-lifecycle and W3-search. Search does not cover device subjects yet.
- Reference sources are builder adapters. A build can leave out any of them
  (FIRDS, FITRS, GLEIF, OpenFIGI, SEC), and its `package.json` lists the
  sources it includes; only the ISO 10383 venue codes and core's curated
  crypto table are always in. A device cannot yet remove an installed
  package.
- Trust follows a digest of each plugin's files, never its name: Pythia's
  release grants confirm its signed-off and grandfathered plugins, and the
  user's own grants may confirm another or demote one (ADR 0042, amendment of
  2026-09-30). Only a confirm-level plugin binds, onto reference or device
  subjects; a display plugin binds only a subject it introduced (ADR 0042,
  amendment "binding by trust level").
- A crypto deployment key (`listing:caip19:`) may come from any plugin, and
  an asset key (`security:caip19:`) from any plugin's canonical-issuance
  claim; only a confirm-level claim aliases a provisional coin to it (a
  user's alias has no path yet), and a platform list never keys an asset
  ([ADR 0037](0037-identity-backbone.md), amendment "ingest"). Core's curated
  table stays the maintained default supplier of those claims, through the
  reference build.

Documents that cite the first version of these rulings describe this current
behaviour or its original plan. The central curator's back office they mention
becomes the Pythia-maintained answer list of A7, and the "finish line" of the
first ruling 9 is superseded by the stage 0 work below.

### Consequences

- **Rulings in other ADRs change as stage 0 lands:**
  - [ADR 0037](0037-identity-backbone.md): crypto keys only from the curated
    table; `snapshot` outranking `source_asserted`; `curated` at the top tier.
  - [ADR 0038](0038-plugin-addressing-contract.md): "Reference sources do not
    emit".
  - [ADR 0039](0039-local-first-reference-data-and-rights.md): a published
    package, as a maintained default without extra authority.
  - [ADR 0042](0042-source-onboarding-standard.md): "The builder's reference
    sources are not plugins", and no subjects before sign-off, for plugins
    that introduce subjects.
- **Roadmap stage 0 gains:**
  - an ordinary plugin adding a subject;
  - contributing evidence about an existing one;
  - appearing in search;
  - keeping saved references through disabling, re-enabling and updates;
  - queueing identity questions only for instruments relevant to a holding,
    research task or operation;
  - removing authority by name or origin;
  - tests of consequential failures.

### Rejected alternatives

- **Central curation as the authority over identity.** This was the first
  version of this ADR. Central maintenance remains as a default, but as the only
  path that creates subjects or settles conflicts it would put every plugin
  below it.
- **Only the reference may create subjects.** Every new domain, such as a DeFi
  ecosystem or a niche market, would wait for a catalogue release.
- **Mandatory reference plugins.** They would guarantee identical identifiers,
  but make Pythia unusable for anyone who does not want part of the market.
  Identifier bundles and aliases give portability without the mandate.
- **Letting the agent settle records at runtime.** Capable models chose
  differently on convention questions.
- **The model tier as the safety boundary.** Saving an answer makes it
  repeatable, not correct. Evidence and the operation's requirements decide
  its use.
- **Raising every world-level question on every installation.** It would make
  every user a data curator.

### Note (2026-09-30): OpenFIGI introduces subjects on demand only

**Context.** Stage 0 shows an overlapping financial source introducing subjects.
OpenFIGI is that source: it is keyless and free, its plugin is grandfathered
(ADR 0042), and its FIGIs identify each level exactly (listing, composite, share
class). OpenFIGI can map any ISIN, so its plugin could also page through ISINs
in bulk and act as a reference source by another route, which A8 leaves open
("direct and prebuilt forms per reference source").

**Ruling.** OpenFIGI introduces subjects on demand only: a single-identifier
lookup, one ISIN, when the investor or the agent asks for it. Its contract
declares `resolve` with input `isin` and `introduces: {"listing": ["figi"]}`, and
no catalogue. There is no bulk mapping and no scheduled sync. The answer is one
listing claim per FIGI line; tickers are evidence only, and an exchange code
becomes an operating MIC only through the contract's `venue_codes`
([source record](../sources/openfigi.md)).

**Rationale.** A lookup covers what stage 0 needs to prove, a line the
reference lacks (Toyota's London line in the build of 2026-09-28), without
deciding the open question of how a reference source ships. It keeps to
OpenFIGI's keyless limits and to ADR 0038's rule that "Look up in X" calls
exactly one plugin's `resolve`.

**Consequences.** OpenFIGI adds evidence to existing listings by FIGI and adds
lines one ISIN at a time; it never widens coverage by itself. A catalogue or bulk
mode waits for A8.

**Rejected alternatives.** A bulk catalogue over the reference's ISINs (a
direct form of a reference source, open under A8), and EODHD as the overlapping
source (paid, and its ISINs are `unqualified`, so nothing joins by ISIN).
