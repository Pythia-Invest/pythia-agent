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

**A4.** **Plugin trust levels** (replaces ruling 10). *Superseded on
   2026-09-30: installing a plugin means trusting it, and there are no levels
   ([amendment below](#amendment-2026-09-30-installing-a-plugin-means-trusting-it)).
   Only the last bullet, code isolation, stands.* There are three levels:
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

Roadmap stage 0 implements this amendment. No package is published and no
central curator exists.

- **Plugins extend the universe on equal terms.** Any plugin can introduce
  subjects and contribute evidence through core's ingest, joined by identifier
  at each record's own scope and introduced only under the key schemes its
  contract declares. Pages and search show them with or without a reference
  package. A saved reference keeps resolving through disabling, re-enabling
  and updates, and its page names its source and says whether that source is
  off or no longer offers it ([ADR 0037](0037-identity-backbone.md),
  amendments "device subjects", "ingest", "search over reference and device"
  and "saved references through a plugin's lifecycle").
- **Sources are read only when asked.** A catalogue is read from Settings →
  Data sources ("Sync now"), and one identifier is looked up in a plugin that
  takes it, from the form on that plugin's row there. Search calls no plugin
  and offers no lookup. There is no scheduler.
- **Search answers from local data, delisted lines included.** A delisted line
  (its own status is inactive, as the price guards read it) is found by name, ticker and
  identifier, marked "Delisted" and ranked below live lines; an "Include
  delisted" toggle in the search panel hides them. Its page still gets no live
  price through the ticker. A security none of whose lines has a ticker is
  found too, as one row marked "No ticker" (amendment of 2026-09-30 below).
- **A source switches off at once, from Settings.** Settings → Data → Data sources
  has a switch per source that pauses it: a paused plugin counts as disabled
  for data, with no restart, and its subjects and saved references keep
  resolving, labelled as paused. The section shows first which subjects only
  that source supplies and which saved watchlist and card entries name them.
  Enabling a plugin Hermes does not run, and disabling one for good, stay
  Hermes's commands ([ADR 0037](0037-identity-backbone.md), amendment
  "pausing a plugin").
- **Installing a plugin means trusting it.** There are no trust levels: every
  enabled plugin is equal, binds onto reference or device subjects, and
  contributes evidence that counts like the package's (amendment of
  2026-09-30 below).
- **Questions on touch.** The build's open questions, and the conflicts between
  plugins' evidence (a plugin-introduced subject's included, and one plugin
  contradicting itself), are asked when an instrument is opened, watched or
  used by the agent, and the user's answer is a local override
  ([ADR 0037](0037-identity-backbone.md), amendments "questions on touch" and
  "questions and overrides for plugin-introduced subjects"). While a question
  is open, the page shows an open data conflict linked to its repair where the
  fact it holds back would be, never a blank (amendment "open data conflicts on
  the page").
- **The investor can correct the catalogue.** From an instrument's page they
  set or remove an identifier and pin the source that prices a line or
  security; the agent can only propose the same, and the investor confirms it
  in Repairs. A correction applies on every read above the reference, the
  plugins and the investor's answers, is undone from the page or Repairs, and
  follows a re-key (amendment "user catalogue corrections" below). Moving a
  listing to another security and ignoring one plugin's record are the next
  part of the same change and are not read yet.
- **Reference sources are builder adapters.** A build can leave out any of
  them (FIRDS, FITRS, GLEIF, OpenFIGI, SEC), and its `package.json` lists the
  sources it includes; only the ISO 10383 venue codes and core's curated
  crypto table are always in. A device can remove its installed package:
  search and pages then read the device's subjects alone, and saved
  references open as labelled stubs ([ADR 0037](0037-identity-backbone.md),
  amendment "search over reference and device").
- **Crypto keys come from claims.** A deployment key (`listing:caip19:`) may
  come from any plugin, and an asset key (`security:caip19:`) from any
  plugin's canonical-issuance claim; a platform list never keys an asset
  ([ADR 0037](0037-identity-backbone.md), amendment "ingest"). Core's curated
  table stays the maintained default supplier of those claims, through the
  reference build.

Still open:

- Holdings, forecasts and operations join as question triggers in stage 1.
- The reference sources' direct and prebuilt forms, and the exact
  evidence-weighing rules, stay open (A8). The defaults name kinds of evidence.
- A user cannot yet alias a provisional coin.
- The effect of disabling a plugin counts coverage (the subjects only it
  supplies), not the identifiers a subject other sources also supply would
  lose.
- Sync, lookup and the effect are Desk operations; the agent's tool list has
  no room for them.
- CoinGecko's and CoinMarketCap's catalogues still answer an older row format,
  so sync cannot read them.

Documents that cite the first version of these rulings describe earlier
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
lookup, one ISIN, when the investor asks for it (from the plugin's row in
Settings → Data sources, [amendment of 2026-09-30](#amendment-2026-09-30-search-is-local-data-only-and-delisted-lines-stay-findable))
or the agent asks for the mapping (`openfigi_identifiers`, which stores
nothing). Its contract
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

### Note (2026-09-30): OpenFIGI's exchange codes are a vocabulary

**Context.** The note above let an exchange code become an operating MIC only
through the contract's `venue_codes`, and the plugin left out the composite
lines and mapped about fifty codes. One-time research with OpenFIGI's own
`micCode` filter (297 requests) showed most of the 285 codes seen: order books,
second books on an operating MIC, trade reports, dark venues, composites, and 41
it could not resolve. Toyota's 143 lines are mostly not order books.

**Ruling.** The founder ruled: "Dropping data is almost never what you want."
Keep every record, learn the vocabulary, and filter visibility later,
downstream. Lines are for real public order books only. The plugin holds the
vocabulary (`vocabulary.json`, [source record](../sources/openfigi.md)) and gives
each code a kind: `exchange`, `second_book`, `us_unlisted_trading`,
`rfq`, `trade_report`, `dark`, `composite` or `unknown`. Only `exchange` codes are in `venue_codes` and so become lines.
Every other line is still emitted as a claim carrying `provider_venue`, parked
(`unmatched`) without an operating MIC, and a new claim attribute, `venue_note`,
says why in words (a trade report, a second book, not in the vocabulary). AU is
Australia's composite and the ASX line is AT. The US exchange codes (UN, UW, UF
and the rest) are not mapped: OpenFIGI gives a US security a line on every US
venue under unlisted trading privileges, so mapping them would show a Nasdaq
stock as listed on NYSE and Cboe. Their kind, `us_unlisted_trading`, keeps the
MIC in the vocabulary; US listings come from SEC (manager ruling). PQ stays
mapped to OTCM. Request-for-quote MTFs (B2, B4, T2, WT) are not order books
either: kind `rfq`, parked.

**Rationale.** A line without an operating MIC is harmless and the reason is
evidence; a dropped line is gone. The classification is the plugin's knowledge of
Bloomberg's codes, so it lives in the plugin, and core changed only by one
optional attribute that every plugin may use. The reason sits in the claim as
stored, readable by SQL, rather than in a new column every plugin would share.

**Consequences.** The contract's `venue_codes` grows from 47 to 106 codes, all
order books, and OpenFIGI adds venue lines it used to park, except the US
exchange codes, which stay parked. A code the vocabulary lacks is kept and says
so. `venue_note` is a new key of every wire record, so the first sync after the
upgrade finds every plugin's stored claims different from the re-emitted ones and
places each once more, then stores it again. That re-place is harmless (same
placements, subjects and identifiers, no new question; tested).

**Rejected alternatives.** Dropping trade-report and composite lines from the
answer (loses data); mapping every resolved code to its operating MIC (several
lines of one security on one MIC, and trade reports shown as order books); a new
nullable column on `claims` for the reason (a core schema addition beside a claim
attribute that already travels with the record).

## Amendment (2026-09-30): installing a plugin means trusting it

### Context

Stage 0 built A4's trust levels: display and confirm, looked up by a digest of
a plugin's files. Pythia's release grants were generated when the payload was
assembled, the user could grant or demote any plugin locally, the reference
package was granted on its own digest, only a confirm-level plugin could bind,
and a plugin below confirm was labelled "not yet audited" and its would-be
binding became an `unaudited` question. The founder ruled on 2026-09-30: "IF
you install 'Japan stocks' that means that you trust it… remove that
distinction." The user chose the plugin; Pythia asking them to trust it a
second time, by a digest they cannot judge, adds friction and no safety.

### Ruling

- **Every enabled plugin is equal.** It can introduce subjects under its
  contract's key schemes, contribute evidence, bind its records to a reference
  or device subject, and alias its provisional IDs. Its evidence counts like
  any other's, including the reference package's. The reference package is
  just another source.
- **This supersedes** A4's three levels and its sentence "trust attaches to a
  signed or hashed release", and the parts of A2 and A3 that weigh evidence by
  "trust level": evidence is weighed by its kind. Gone with them are the
  plugin-file digest, Pythia's release grants and the user's local grants, the
  package grant, the `vouched` contract, the "not yet audited" label, the
  `unaudited` residual, ADR 0042's "binding by trust level" and the Settings
  labels "Confirms identity" and "Display only".
- **Conflicts stay.** Evidence from different plugins or sources that
  disagrees on a single-valued fact leaves it contested: every value is kept,
  none is applied, and a question is asked when the subject is touched. The
  user's answer is a local override and wins, refused only by unanimous
  identifier proof. One source's several values (A2) are no conflict.
- **A plugin that is off or removed** keeps its subjects' labels and
  identifiers on the device, shown with their source, but what it stated does
  not prove, block or contest while it is off. That follows from disabling,
  not from a level.
- **Default enablement is a product default.** DeFiLlama, Hyperliquid and the
  FCA NSM plugin stay off in fresh profiles, and enabling one is the opt-in.
- **`signoff` in a plugin's contract** stays as a record of Pythia's own audit
  under [ADR 0042](0042-source-onboarding-standard.md), which stays Pythia's
  quality process for the defaults it ships. No code reads it.
- **Source selection** keeps [ADR 0040](0040-data-concepts-and-agent-tools.md)'s
  one order (the investor's, then core's default order, then by plugin ID),
  without the rule that an unsigned source is never core's own pick: any
  enabled plugin can be picked by the default order.
- **Code isolation** (A4's last bullet) still stands: isolating plugin code is
  required before an open marketplace.

### Rationale

- Installing is the decision. A plugin the user did not want is not installed;
  one they did want should work on equal terms, as the vision says.
- The levels were a second, hidden decision. Confirm or display by digest
  meant a user who edited a plugin's file, or updated it, lost its binding
  powers until a new grant was recorded, and had no way to read the digest.
- What protects the data is conflict, not rank: a wrong value that another
  source contradicts is contested rather than applied. The other remedies are
  the user's (disable the plugin, answer the question).
- It removes a generator run at every assembly, a generated file in core's
  payload, a local grants file in the config folder, a parity test between
  assembly and runtime, and a separate rule for display plugins in ingest,
  evidence, relations, search and binding.

### Consequences

- **There is no protection against a buggy or malicious plugin** other than
  disabling it, correcting its data, or conflicts being raised. A plugin that
  states a wrong value no other source contradicts is believed. Code isolation
  stays required before an open marketplace.
- Two plugins that send the same records under different names, whatever
  sign-off each declares, give the same subjects, evidence, pages and search
  results.
- An existing `trust.json` in the Pythia config folder is ignored, and core
  no longer writes or reads one. `reference_package install` takes no
  `--display` and needs no config folder.
- A disagreement between two plugins that an earlier version ranked by level
  is now a contested fact and a question on touch. Two plugins that name
  different parents for one device line leave the line without a parent
  (neither wins), and another plugin's line on the same exchange counts as a
  second line there, so a currency-less record that would have joined the
  exchange's one line stays unmatched.
- Evidence Pythia cannot rank stays unranked: the exact weighing rules remain
  open (A8).
- The remedies the founder named, an explanation of where a value comes from,
  an on/off switch per plugin in Settings, and user corrections to the
  catalogue, are separate changes; none of them is part of this one.
- Earlier amendments' text on levels is superseded where it conflicts: ADR 0037
  ("evidence counts by kind and trust level", "binding", the search tie-break),
  ADR 0038 (a declared address `confirmed` only at confirm level), ADR 0040
  ("Unaudited sources") and ADR 0042 (its three trust amendments).

### Rejected alternatives

- **Hash-bound levels (A4 as built).** They tie trust to reviewed content, but
  the user never reviews the content, every update changes the hash, and
  Pythia's own grants needed generating and guarding. The protection they gave
  was against a plugin under a trusted name, a risk a user who installs
  plugins by choice already carries.
- **Levels by origin** (shipped, community, the user's own). They are
  authority by origin again, which A1 rules out.
- **A single "verified" badge** kept for Pythia's audited plugins. It would
  make every unbadged plugin second class in the interface while changing no
  behaviour.

## Amendment (2026-09-30): user catalogue corrections

### Context

The founder's ruling that installing a plugin means trusting it (the amendment
above) named the remedies for a plugin that is wrong: an explanation of where a
value comes from, an on/off switch per plugin, and "manual overwrites to the
catalog in case there are issues with plugins but you want to keep using them".
The explanation became the stores' own provenance and the `pythia:identity-data`
skill, and the switch became the pause in Settings. The investor's answer to a
question is already a local override, but it exists only where a source is
contested or a build asked; it cannot say "this ISIN is wrong", "this source
should price this line", or remove a value nobody contests.

### Ruling

- **A correction is a local override the investor makes on purpose, at the top
  of the precedence.** It applies on every read above the reference, every
  plugin and the investor's answers to questions, and it changes no ingested
  row, so a sync cannot revive what it overrode.
- **Two kinds are built now.** An `identifier` correction sets one scheme of a
  subject, at the level the scheme identifies, or removes it. A `price_source`
  correction pins a plugin as the source of a line's or security's quote, chart
  and live price; a failing pinned source falls through to the next and the
  page says so. The kinds `parent` (move a listing to another security) and
  `detach` (ignore one plugin record's statements about a subject) are
  reserved in the schema and refused until they are read.
- **Only the investor makes one apply.** The Desk writes it `active` with the
  user's turn, and the table refuses an `active` row without one. The agent's
  call writes a `proposed` row that applies to nothing (A2's rule that an
  agent's answer changes nothing until the user confirms). Confirm, decline and
  undo are Desk operations; the agent has no tool for them.
- **Corrections are their own table, `corrections`, in the identity store.**
  The question machinery (`queue`, `verdicts`) cannot carry them: a verdict
  needs a question, refuses an answer that unanimous identifier evidence
  contradicts (a correction exists for exactly that case), and has no relation
  for set, remove or pin. The conventions are reused: `user_attested`
  authority, a `user_turn`, rows kept as history, and the store's `generation`,
  which every write and undo bumps so search renews.
- **One active row per fact.** A newer correction replaces the older (it stays
  as `undone`, cited in `replaces`). A re-key of a subject re-points its
  corrections, and where two now state one fact the newest stays.
- **The surfaces stay small.** The identifier is edited in place in the
  instrument header (an empty value removes it), "Always use" sits beside
  "Back" on a price section's sources line, "Corrected by you · Undo" marks the
  corrected item and the settled rows of Settings → Repairs, and the agent's
  proposals are Repairs rows. There is no explanation panel.

### Rationale

- A correction marks a plugin or source issue worth investigating. Each one stays
  visible in the raw data so it can be reviewed and retired once the plugin is
  fixed.
- The founder asked for a way to keep using a plugin that is wrong in a few
  places, without waiting for it to be fixed and without disabling it.
- Overriding on read, never in the ingested rows, keeps the evidence intact and
  makes undo exact: the data reads as before.
- Letting the agent only propose keeps A2's boundary: a correction changes what
  the investor sees and what price they read, so they decide.

### Consequences

- A corrected identifier does not change the evidence a plugin's resolve is
  checked against, so a plugin that resolves by the corrected value can still
  be refused by the source evidence it contradicts, as it is for an answer to a
  question. A corrected FIGI does change the address core derives from it.
- A pin applies to the subject it names and, for a security, to its lines; a pin
  on a line beats one on its security. A pin on a plugin that is later
  uninstalled applies to nothing.
- The store schema stays at 6: an older store gains the table when it is next
  opened, and an older Pythia ignores it.
- The effect of `parent` and `detach` on search and pages is part of the
  follow-up change and is not designed here.

### Rejected alternatives

- **Reusing questions and verdicts.** Only "set an identifier" fits, through a
  chosen candidate, and it is refused where the evidence is unanimous.
- **Editing the ingested rows.** A sync would revive the old value, and undo
  would have nothing to restore.
- **Letting the agent write an active correction** on the user's confirmation in
  chat. A chat turn is not a Desk action the store can check, and A2 already
  names Repairs as the place a suggestion becomes the user's.
- **Trust levels for who may correct** (removed above), and an explanation panel
  (the founder asked for well-modelled data instead).

## Amendment (2026-09-30): search is local data only, and delisted lines stay findable

### Context

Two rulings by the founder. First, "the search should fully work with the local
data": search offered "Look up in OpenFIGI" for an identifier the directory did
not hold, a plugin-specific action reached from a search screen. Second,
delisted and inactive instruments disappeared from search: the directory
dropped every line whose listing or security is inactive, so Milkiland
(`security:isin:NL0009508712`, delisted in Warsaw) could be found neither by
name nor by ISIN, although its page opens by id and the reference holds it.

### Ruling

- **Search never calls a plugin.** It offers no lookup, in the background or
  from its interface. A plugin's own function lives on that plugin's own
  place: any plugin that declares a `resolve` (not only OpenFIGI) gets the same
  small, generic lookup form on its row in
  Settings → Data → Data sources (an identifier in; the counts of records
  joined, introduced, in conflict or unmatched, and the subjects they were
  placed on, out). The form calls `identity-lookup`, which calls exactly that
  plugin once. The search answer no longer has a `lookup` field.
- **No plugin page framework.** The existing Data sources row is the place;
  nothing else is built. A plugin's widgets (ADR 0032) remain the way to give
  it a richer surface.
- **Delisted lines are found.** A line is delisted when its own status is
  inactive, whatever the source: the rule the page's price guards use, so a row
  marked delisted is exactly a row that gets no live price. An active line under
  an inactive security (54 in the 2026-09-28 build, such as AvePoint) is live
  and unmarked; it stays out of the page's listing selector and price pick as
  it always did (the security's status keeps it out of those, not out of search). Search finds it by name, ticker
  and identifier like any other line, marks it `delisted`, and ranks it below
  live lines: a group with a live line before a group with only delisted lines,
  and within a group, live lines first (also as the line that represents a
  security). A live receipt whose share is delisted stays its own instrument.
  A subject a plugin marks inactive (a dead DeFi protocol) is treated the same.
- **A security with no ticker is found.** Search holds everything the device
  holds: a security none of whose lines has a ticker (live or delisted) is one
  row, through its primary line (else the first by id), found by name and by
  identifier, marked "No ticker" (and "Delisted" if inactive), and ranked below
  lines that have a ticker. A line with no ticker of a security that has one
  adds no row. Like a delisted line, such a row never joins the page's listing
  selector or the line a security page prices through.
- **A way to hide them.** Search takes `include_delisted` (default true), and the
  search panel has an "Include delisted" toggle, on by default, kept for the
  session only, so a reload shows delisted lines again: Desk has no per-viewer
  preference mechanism for a plugin's widget, and this one is cheap to set
  again. When they are hidden and nothing else matches, the empty state says
  "Delisted results are hidden".
- **Pages and prices are unchanged.** The instrument page's listing selector and
  the line a security page prices through leave delisted lines out, as before,
  and a delisted ticker still addresses no price source (tickers get reused).
  Market data is out of scope for this change.

### Rationale

Search is a read of what the device holds; asking a provider from it makes a
read write to the store and call a third party, and puts one plugin's function
on a screen every plugin shares. A delisted instrument is still an instrument
an investor holds records about, researches after the fact, or has saved, so
hiding it is a silent loss; flagging and ranking it keeps the answer honest
without crowding live lines.

### Consequences

- An investor who used the search button now opens Settings → Data → Data
  sources, types the ISIN in the plugin's row, and then searches. The agent
  reads OpenFIGI mappings through `openfigi_identifiers`, which stores nothing;
  only the form stores a lookup.
- Search results can contain delisted lines: rows carry `delisted: true`, and
  the agent's `pythia_find` sees the flag.
- The effect of pausing a plugin counts an inactive subject as supplied only by
  that plugin, because search finds it.
- The directory grows by one row per security without a ticker: on the
  2026-09-28 package (135,596 lines), 7,188 rows (+7.7%, 207 of them delisted),
  +6.6 MB of index (+7%), no change in build time (about 2.7 s) and no
  measurable change in query latency (all under 1.3 ms).

### Rejected alternatives

- **Indexing every tickerless line.** About 42,000 near-duplicate rows; one row
  per security answers "is it held" without them.
- **Keeping the lookup in search but moving it behind a setting.** It is still
  a plugin-specific action on a shared screen.
- **A plugin page framework** (a route and layout per plugin). Nothing needs it
  yet; the data sources row does.
- **Hiding delisted lines by default, with a toggle to show them.** The founder
  asked that they never disappear, so they show unless the investor hides them.
- **A penalty weight instead of a rank tier.** A delisted line with an exact
  ticker or ISIN match could then outrank a live match, against "below active
  matches".
- **Persisting the toggle in browser storage.** Desk has no shared mechanism for
  a plugin widget's preference, and a second ad hoc one is not worth it for a
  filter.
