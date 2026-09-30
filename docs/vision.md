# Pythia vision

This document describes what Pythia is becoming and the principles that guide
it. [Product](product.md) describes what exists today, and the architecture
documents and decision records ([ADRs](decisions/)) describe how it works.
[ADR 0044](decisions/0044-product-direction.md) records the decisions behind
this vision and the earlier rulings it amends. The vision will be refined as it
is built; material changes go through a new or amended ADR.

## Summary

Pythia is a self-hosted workbench for investment research and decisions with AI
agents: a coding agent for investing. An investor gives agents a **mandate**.
The agents research continuously, decide within the mandate's limits, and
record every decision in a verifiable **ledger**, together with the evidence
behind it and explicit forecasts that can later be scored. The investor reviews
the work, approves anything that involves real money, and can see over time
whether the agents actually have skill. Investors can also develop new
strategies together with the agents, starting from real market observations
and proving them on paper before any capital is involved.

Pythia is open, local-first and extensible. Research, strategies, credentials,
portfolios and ledgers stay on a machine the investor controls. Every plugin can
introduce subjects and contribute evidence through the same supported contract.
Pythia provides maintained defaults, including open reference data, and users
can replace or supplement them.

## Why this matters

Reading filings and news, researching industries, and following how
institutional money moves used to require teams of analysts. Many AI agents can
now do much of this work in parallel, continuously and without fatigue. The
limit is no longer capacity. It is whether the agents' work is effective, and
whether an investor can trust it.

Pythia is built around that problem. It gives agents good data and tools. It
also gives the investor a way to measure the agents' judgment honestly, and to
decide how much autonomy they earn.

## Principles

1. **Measure judgment forward.** An LLM has already seen the outcomes of the
   period it was trained on, so a historical backtest of its judgment is not
   evidence of skill ([Lopez-Lira, Tang and Zhu, 2025](https://arxiv.org/abs/2504.14765);
   [FINSABER, 2025](https://arxiv.org/abs/2505.07078)). Pythia builds evidence
   forward instead: decisions are recorded when they are made, with explicit
   probabilistic forecasts that are scored as they resolve. Returns alone need
   many years to separate modest skill from luck
   ([Bailey and López de Prado](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)).
   Scored forecasts give useful evidence much sooner.
2. **Agents are research engines first.** Autonomy is earned from a measured
   record, not assumed.
3. **Evidence over assertion.** Every figure carries its source and as-of time.
   When the evidence does not decide something, the answer is "unknown", never
   a stored guess. For an agent, "no action, insufficient evidence" is a valid
   decision.
4. **Agents propose, people decide.** Money moves only with the account owner's
   explicit approval, enforced in code rather than in prompts.
5. **Your workspace, your data.** Research, strategies, credentials, portfolios
   and ledgers stay on the investor's own machine. Pythia's services never see
   what an investor researches.
6. **Extend on equal terms; maintain good defaults.** Confidence in an
   assertion comes from the kind of evidence and the plugin's trust level,
   never from its name, from being bundled, or from arriving as a prebuilt
   package. Pythia's maintained defaults work out of the box and can be
   replaced or supplemented.
7. **Extend without forking.** Everything a builder customises is a file or a
   plugin. The core stays upstream and keeps updating.
8. **Provider-neutral and free-first.** Pythia works with free and open sources
   by default. Paid sources, including those a team already licenses, add to
   the free defaults rather than replacing them.
9. **Simplicity.** Build the smallest capability that serves a demonstrated
   need. Larger infrastructure waits for a concrete trigger.

## Who Pythia is for

Pythia serves three kinds of user, in this order.

| | Builder-investors | Investment teams | Strategy subscribers |
| --- | --- | --- | --- |
| **Who** | Technically comfortable investors who run their own server | Analysts and portfolio managers at small funds and family offices | Investors who want to follow a proven agent strategy |
| **What they want** | Power and control: many agents, their own data, customise everything | A platform that works: data included, reliable, private, auditable | Results and a track record they can verify |
| **What they do** | Write strategies and skills, add plugins, run agents, tinker | Set mandates, review and approve decisions, ask questions, write research | Choose a strategy, set their own limits, approve trades |
| **What they should never have to do** | Nothing is off limits | Install software, manage credentials or plugins, resolve data conflicts, repair broken sources | Anything technical |

The first users are builder-investors. A hosted offering for teams follows once
agent strategies have a track record worth showing. Its exact form will be
shaped with the teams themselves. The two audiences share one engine: builders
develop and prove strategies, and teams run them. What differs between them is
who operates the software and what is included, not the software itself.

## The core loop

1. **Mandate.** The investor adopts a strategy with explicit limits.
2. **Research.** Agents work on a schedule and in response to events such as a
   new filing, a news item or a price move. They read filings, news,
   fundamentals and market data through Pythia's tools.
3. **Decision.** An agent records a decision: act, or deliberately take no
   action. It includes a thesis, references to the evidence it used, a target
   weight, and two to five forecasts that can be resolved later.
4. **Guard.** Deterministic code checks the decision against the mandate's
   limits before it is recorded as actionable.
5. **Review.** The investor sees the thesis, the cited passages, the forecasts,
   the guard result and the cost, and can approve, reject or ask for more.
6. **Paper or live.** Every mandate runs on paper first. Real orders exist only
   for the owner's own accounts and only with the owner's approval.
7. **Scoring.** Forecasts resolve against prices and reported facts. Mandates
   are compared with simple baselines, and results are attributed to selection,
   sizing and timing.
8. **Learning.** Post-mortems and scores feed back into strategies and skills.
   New strategies, including those an agent proposes, enter as new paper
   mandates and earn their record the same way.

## Key concepts

- **Strategy:** a method, described in prose and skills. It can be shared.
- **Mandate:** an investor adopting a strategy with limits: universe,
  benchmark, maximum position size and number of names, horizon, monthly
  inference budget, autonomy level and review cadence. The limits live in a
  small machine-checked file next to the strategy's prose. Changing them
  requires the owner's approval.
- **Capital authorisation:** a separate, explicit act by the account owner.
  Adopting a strategy never implies it.
- **Decision:** one entry in the ledger. Decisions to take no action are
  recorded as well.
- **Forecast:** a probability attached to a decision, with a resolution source,
  date and criteria. For example: "Company X beats its sector index over the
  next 12 months: 0.6."
- **Ledger:** the append-only record of decisions and forecasts. Each entry is
  chained to the previous one by hash, and the chain is time-stamped outside
  the machine every day, so the record can be verified and cannot be quietly
  rewritten.
- **Paper book:** simulated execution at the first observed price after a
  decision, with realistic costs. Pythia keeps a book as the agent proposed it,
  a book as the owner approved it, and a book of rejected proposals. The
  difference between the first two shows what human oversight adds.
- **Order ticket and approval:** a concrete order computed and checked by
  Pythia, and proof that the owner approved exactly that order.
- **Job:** scheduled or event-driven work, with deduplication, a budget and
  catch-up after downtime.
- **Subject:** a permanent identity for anything Pythia reasons about: an
  issuer, a security, a listing, an index, a currency pair, a crypto asset, a
  DeFi protocol or pool.
- **Source:** a plugin that provides data, with declared coverage and terms.

## Strategies and mandates

Strategies come from conversation. An investor discusses an idea with Pythia,
the agents gather evidence from the market, and the idea becomes a paper
mandate with explicit limits and forecasts. Very different kinds of judgment
fit the same loop. For example:

- **Under-followed companies:** undervalued companies that few analysts cover,
  where the agent judges both value and the catalyst that could bring
  attention.
- **Sector rotation:** holding the leaders within a theme and rotating as the
  market changes. This is partly testable with rules and partly a matter of
  judgment.
- **Stablecoin yield allocation:** comparing on-chain lending yields while
  judging whether a yield is sustainable, and the risk of the protocol or the
  stablecoin failing.

Exploratory strategies remain free-form Markdown. Only a mandate that runs
needs a machine-checked limits file.

## Evaluation and the ledger

The ledger is the foundation of trust, and later of anything that is shared or
rented.

- **Everything is recorded, including negatives:** actions, deliberate
  no-actions, guard rejections, owner rejections and abandoned ideas. Recording
  them before the outcome is known prevents selective memory.
- **Evidence is stored as references,** meaning source, as-of time, document
  and offset, never as copies of licensed data. A ledger can therefore be
  exported and verified without redistributing anyone's data.
- **Scoring uses proper scoring rules** (the Brier score and calibration) and
  compares against baselines under the same constraints:
  - an equal-weight universe;
  - a benchmark;
  - a random pick with the same sizing and turnover;
  - the same model with no research tools.

  The last baseline shows whether the research itself adds anything.
- **Backtests remain valuable for rule-based strategies.** They are clearly
  labelled with their known biases (survivorship, costs, the number of trials
  run). Historical replays of agent judgment are useful for testing the
  pipeline and are always labelled "not evidence".

## Execution and safety

These rules are product invariants.

- **An agent can only propose an order.** Pythia computes the quantity, checks
  the mandate's limits and a price collar, and produces an order ticket.
- **Execution is never a tool an agent can call.** It is not an operation a
  widget can invoke directly either.
- **Approval is proven by a person, through a channel the agent cannot reach.**
  The first form is placing a Pythia-drafted order in the broker's own
  application. Later forms include device-bound confirmation over the exact
  ticket. Approvals never extend to "this session" or "always" when money is
  involved.
- **Limits are enforced at the broker as a backstop:** trade-only credentials
  that cannot withdraw, and dedicated sub-accounts funded only up to the
  intended loss budget.
- **Agent code execution is sandboxed before any live trading credential is
  connected.** A single action switches every mandate to paper and cancels open
  orders.
- **Pythia executes only on the owner's own accounts.** The Pythia project does
  not manage anyone's money, hold customer credentials or provide investment
  advice. Users are responsible for complying with the rules that apply to
  them. Any form of sharing strategies with others will be reviewed against
  applicable regulation before it is offered.

## Architecture direction

### Local workspace, extensible data

Everything that belongs to the investor stays on their machine: research
files, strategies, skills and mandates; credentials; portfolio positions and
transactions; the ledger, paper books, orders and approvals; and agent runs,
which use the investor's own model credentials.

Data enters through plugins. Core defines the contract: subject kinds,
identifier rules, the claim format, and the rules that combine claims into
subjects and relations. Plugins contribute claims; they do not reconcile.
Pythia's default plugins, including open reference data, are one set of
contributors among others. Today the reference data is still produced by a
separate builder rather than by plugins; see [Data and identity](#data-and-identity).
Where a source's licence allows, Pythia may also
ship a plugin's output prebuilt so that an installation works immediately. A
prebuilt package has no more authority than the same plugin run locally.

Prebuilt data and curated datasets are delivered as downloads with regular
updates, not as a live query service. No service learns which companies an
investor looks at, because for an investment team that is its edge. An
installation keeps working offline.

### Ownership of the engine

- **Pythia owns its domain engine and its state:** subjects and sources,
  mandates and guard, the ledger, portfolio, jobs, order tickets and approvals.
  Its stores live in Pythia's own data directory: the identity store and
  reference packages in `<data>/store`, and the document cache in Pythia's
  cache directory.
- **An agent harness runs agent turns.** Today this is Hermes. The goal is a
  single adapter, which keeps the harness replaceable, and plugins that use a
  small, versioned Pythia platform interface and never import harness
  internals. The interface exists: every bundled plugin reaches core only
  through `pythia_platform`
  ([ADR 0045](decisions/0045-plugin-platform-interface.md)) and imports no
  Hermes module, and the connector toolkit is core's, so each connector
  depends on core alone. Core's reads of Hermes's plugin-manager state sit in
  one file; two other private Hermes seams remain, named in ADR 0045. Core
  itself still imports Hermes's public modules directly; the single adapter is
  planned, not built.
- **The engine starts in the existing backend process** and moves into its own
  process when there is a concrete reason: live automated execution with
  isolated credentials, a native client, a harness replacement, or a hosted team
  deployment.
- **Clients use a documented Pythia API.** The browser Desk is the current
  client. Native macOS and Windows clients are planned. They will use the same
  API rather than reimplementing domain rules.
- **Python and TypeScript remain the implementation languages,** with SQLite
  and ordinary files for storage. An analytical store (columnar files queried
  in process) arrives with systematic backtesting. Heavy analysis runs in a
  separate Python environment, not inside the agent harness.

### Extension model

Builders customise Pythia without forking it:

- **As files:** strategies, mandates, skills, prompts and agent roles (for
  example an analyst or a red-team reviewer).
- **As plugins:** data sources, account readers, datasets, widgets, schedules
  and monitors.

A strategy can then be packaged with its skills, a mandate template and its
data requirements, expressed as kinds of data rather than vendor names. It can
be installed on another installation that satisfies those requirements with
its own sources.

## Data and identity

### Extending the universe

The product rule: **every plugin can introduce subjects and contribute evidence
through the same supported contract. Pythia provides maintained defaults, and
users can replace or supplement them.** Equal access to these capabilities does
not mean equal confidence in every assertion.

The identity backbone ([ADR 0037](decisions/0037-identity-backbone.md)) is what
lets many plugins connect without every pair of sources needing its own
mapping. Its job is to be a permanent address book for everything an investor
holds, watches or forecasts, whichever plugin it comes from.

**Core owns the rules; plugins contribute the contents.** Core defines a small
set of subject kinds (such as issuer, security, listing, index, market, data
series and protocol), the rules for forming identifiers, the relations between
subjects, and the matching rules. Plugins add subjects within those kinds. This
follows the model of home-automation platforms such as Home Assistant:
integrations add any number of devices, but within a fixed set of entity types,
which is why the interface and automations work generically across all of them.
A genuinely new kind is a rare addition to core. New subjects never are.

- **Any plugin can introduce subjects.** A plugin may introduce a subject that
  no source yet covers, under its native identifier scheme or under open
  identifiers. A plugin for a national market adds its stocks under their ISINs
  (share-class FIGIs where ISINs are licensed). A DeFi plugin adds a token or
  pool under its exact chain-specific identity, makes it searchable, exposes its data and keeps
  references to it, without waiting for a catalogue release. Separately, it can
  contribute evidence about how its subjects relate to others, for example that
  a token is the stablecoin its issuer documents. Because identifiers are
  derived from open or native identifiers, every installation with that plugin
  arrives at the same identifiers, so these subjects are first-class: they get
  pages, can be watched, forecast and held, and appear in the ledger like any
  listed security.
- **Introducing a subject confers no authority over it.** Facts about any
  subject, including one a plugin introduced, are weighed by the kind of
  evidence and the plugin's trust level: for example, which company a ticker
  belongs to, which share a depositary receipt represents, or which asset a
  pool holds. The absence of competing evidence never increases a plugin's
  authority, so disabling one plugin does not make another the authority over
  its instruments.
- **Links are made by identifier agreement at the right scope.** An identifier
  links records only at the level it identifies: an ISIN or share-class FIGI
  links securities, an LEI links issuers. A shared issuer never makes two
  instruments the same. When the evidence is ambiguous, the link stays
  unresolved rather than substituting another instrument.
- **Identifiers come from identifiers, not from sources.** Any enabled plugin
  that supplies the same identifier leads to the same subject.
- **Default plugins are preinstalled, never mandatory.** Disabling a source
  that only maps identifiers mostly lowers identity quality, because other
  plugins still bring the same instruments in. In a measurement of the proposed
  peer design on a full reference build, disabling the source of share-class
  FIGIs removed under 1% of securities but left about a third without their
  stable identifier. Disabling a source that alone brings instruments in
  removes them: about a fifth without the SEC sources. Pythia shows the effect
  before a plugin is disabled.
- **Shared artefacts carry identifier bundles.** A strategy package or ledger
  export lists every known identifier for each subject. The receiving installation resolves it with its own plugins,
  strongest identifier first, and leaves an ambiguous match unresolved.
- **Subject identifiers never disappear.** They survive rebuilds, renames and
  corporate actions through aliases and successor links. A forecast made today
  must still resolve years from now.
- **Holdings come first.** A position or record that no source can identify
  still appears, labelled as unmatched, instead of being dropped.
- **Questions only where they matter.** Pythia queues an identity question
  only when the instrument becomes relevant to a holding, a research task or an
  operation: held, watched, opened, forecast or used. It does not proactively
  ask about the rest of the world, whatever venue an instrument trades on.

Today:

- any plugin can add subjects and evidence through core's ingest, joined by
  identifier and introduced only under the key schemes its contract declares,
  and search finds them; its catalogue is read, or one identifier looked up,
  through Desk operations with no scheduler, whose Desk controls are still to
  come;
- reference sources are builder adapters: a build can leave out any of them
  except the ISO 10383 venue codes and core's curated crypto table, and lists
  the ones it includes, and a device can remove its installed package;
- only confirm-level plugins bind, onto reference or device subjects, and a
  display plugin binds only a subject it introduced;
- the build's open questions are queued only when an instrument is opened,
  watched or used by the agent, not yet when it is held or forecast.

Letting any plugin add subjects and evidence through the same contract, and
queueing questions only for instruments that become relevant, is roadmap
stage 0 ([ADR 0044](decisions/0044-product-direction.md), amendment A1 to A8).

### Identity, evidence and choices

Many apparent conflicts are different kinds of question and need different
handling:

| Question | Handling |
| --- | --- |
| Are these records the same instrument? | Requires evidence at the correct scope. An unresolved result stays unresolved |
| Which listing should this chart or page show? | An explicit preference or a documented default. Several valid choices can coexist |
| Which instrument, price series, currency and fill policy does a forecast or paper decision use? | Pinned when the forecast or decision is created |
| What does conflicting evidence imply for an investment thesis? | The agent investigates and explains its interpretation |

For example, showing a company's euro listing on a chart does not require
deciding which of its exchanges is universally its "home". A paper decision
needs a particular instrument, price series, currency and fill policy; it does
not need every descriptive disagreement resolved.

### Where conflicts are resolved

An analysis of a full reference build over EU and United States securities
(28 September 2026, 11,965 open identity questions) found:

- about a fifth were settled once the open sources already downloaded
  contributed evidence as peers, and about half with an exchange-code table and
  one more rule (measured);
- about a quarter concerned instruments that trade in Europe only on
  bank-internal, request-for-quote or dark venues; their questions are not
  queued unless the instrument becomes relevant to a holding, research task or
  operation;
- about a tenth already had the answer in downloaded data and need a simple
  rule, about one in twenty were stale records or lines on venues nobody
  requested, and the rest need lookups not yet run or sources not yet
  installed (estimates);
- about fifty (0.4%) needed judgment, nearly all about which of two listings is
  a company's primary one, which is a choice rather than an identity question.

Several of the errors found have since been fixed; the figures describe that
build. The approach that follows:

| Conflict | Example | Handling | What the user sees |
| --- | --- | --- | --- |
| Missing evidence | A register sees only the German trading lines of a foreign share, while another source knows its home exchange | Rules combine the evidence of all enabled plugins | Nothing to do |
| Source errors | A register field naming the wrong company | Rules that name kinds of evidence, never sources: for example, a company's own regulatory filing outweighs a trading venue's report of its issuer | Nothing to do; a contradicted link is marked |
| Corporate actions | A share consolidation that changes an ISIN | Lifecycle data: successors, ratios and effective dates | Old references keep resolving through successor links |
| Listing choice | Which of two exchanges a dual-listed company counts as primary | A preference or documented default; pinned where a decision depends on it | The listing in use, with the alternatives |
| Subjects only one plugin describes | DeFi pools and protocols; a vendor's proprietary indices | The plugin's claims count at its trust level, labelled with their source; the absence of other plugins does not raise them. Links to shared subjects are made by identifier agreement | New subjects appear with the plugin's label |
| Vendor symbols | Mapping a vendor's ticker to a listing | Automatic matching by open identifiers when the plugin connects | A summary of what matched, and what stays available only from that vendor |
| The user's own unmatched records | A broker position or wallet token that no source identifies | On the user's machine, only when it matters. An agent proposes a match and the user confirms | The record appears immediately, labelled "not matched", with a suggestion |
| Values that differ | Two vendors reporting different revenue | Never merged: single values are shown side by side, lists are merged without duplicates, and a price view uses one source ([ADR 0040](decisions/0040-data-concepts-and-agent-tools.md)) | Labelled rows |
| A source changes | A vendor alters a field | Detected by drift alarms and fixed by the plugin's maintainer | "Source changed, fix pending". Affected views show stale labels, never wrong data |
| Plan limits | A key that covers end-of-day data but not intraday data | The plugin's connection check records what the credential allows | An inspectable connection result. Selection skips what is not covered |

- **Default rules are open and versioned.** The rules that combine evidence are
  published, changelogged and overridable locally. Installations with different
  plugins, data dates or overrides can reach different facts under the same
  rules. A shared strategy therefore pins the meaning of its rules and declares
  its data requirements, and separate installations need not reach identical
  new decisions. Reproducing a historical decision uses the facts it selected,
  its evidence references and the relevant versions, which the ledger keeps.
- **Conflicting claims are kept.** A claim that loses is marked, not deleted,
  so the evidence stays inspectable.
- **Local fixes can be shared** with a plugin's maintainer by explicit opt-in
  per fix. Only identifiers and reasoning are sent, never positions or
  holdings.
- **When a user's own vendor disagrees with other evidence,** the rules decide
  by evidence kind and trust level. Where they do not, the link stays
  unresolved, the disagreement is shown, and a local override makes the user's
  choice win on their installation.

### Uncertainty, the agent and consequential operations

- **Recording uncertainty is allowed.** Research, notes and ledger entries may
  record a contested fact together with the interpretation used.
- **Consequential operations need validated facts and pinned choices.**
  Simulating a fill, carrying a position across a corporate action, merging
  positions, checking an issuer limit and creating an order ticket each require
  their factual inputs, such as an issuer link or a split ratio, to meet that
  operation's evidence requirements. Their choices, such as the listing, price
  series or fill policy, are pinned. Pinning preserves a choice; it never makes
  a guessed fact suitable for changing a position. When an input is contested
  or missing, that operation is unavailable with a clear reason, and the rest
  of the workflow continues. An unconfirmed agent interpretation never counts
  as a validated fact.
- **What the agent sees.** Reads give the agent a default value, a typed flag
  (such as limited coverage, tradability or a corporate action) and the
  provenance, with the full evidence on request. The agent states which
  interpretation it used, and retrieves evidence or abstains rather than
  relying on what it remembers. Built for instrument reads: `pythia_instrument`
  gives the listing in use as the default, typed flags from a closed list and
  each identifier's source and trust level, and the full evidence of a question
  comes through `pythia_identity_questions`
  ([the agent's tools](architecture/agent-tools.md)).
- **Saved interpretations are suggestions.** An agent's answer to an identity
  question is a suggestion the user confirms. A saved interpretation keeps its
  evidence, scope and dependencies, and becomes stale when they change. Saving
  it makes it repeatable, not correct: whether it may be used by a
  consequential operation depends on its evidence and that operation's
  requirements, not on which model produced it.

### Plugin trust levels

| Level | May | Requires |
| --- | --- | --- |
| Display | Provide data that is shown with its source, and introduce subjects under open or native identifiers | Declared coverage and terms, and the identifier scheme of any subjects it introduces |
| Suggest identity | Propose facts about shared subjects for review | Documented field semantics |
| Confirm identity | Establish facts about shared subjects without review | The full [source onboarding](architecture/source-onboarding.md) audit and sign-off |

Adding subjects and data needs no audit, so community plugins are cheap to
write and a user's own paid data is fully usable. The audit is reserved for
establishing facts that other sources also describe.

- **What a plugin's claims can establish is bounded by claim type and trust
  level.** A plugin cannot raise it by labelling its claims.
- **Trust attaches to a plugin's content, not its name.** Trust is tied to a
  signed or hashed release, so a different plugin that reuses an audited
  plugin's name does not inherit it. Today it follows a digest of the plugin's
  files; signatures come with a published release.
- **Trust levels limit what data can do, not what code can do.** Running
  untrusted community code safely also requires isolating plugins, which is
  planned before an open marketplace.

Today two levels exist, set by a grant on the digest of the plugin's files:
Pythia generates grants for its own plugins from their sign-off, and a user's
own grant may confirm or demote any plugin. A plugin without a confirm grant
is display (off until the user enables it, then merged into lists and shown
side by side, labelled "not yet audited"; for a single-source view it comes
after every audited source, serving only if the user names it or nothing
audited can), and one with a confirm grant confirms. Suggest
arrives with the first plugin that needs it
([ADR 0042](decisions/0042-source-onboarding-standard.md)).

### Connecting a plugin

1. **Install or enable the plugin.** Its card shows its trust level and its
   provider's terms.
2. **Add a credential.** The connection check shows what the plan allows, how
   much of the vendor's universe matched existing subjects, and which new
   subjects the plugin adds.
3. **Choose placement.** Choose whether the source comes first for the kinds of
   data it serves, or complements the defaults.
4. **Use it.** Its data appears labelled by source, for people and agents
   alike.
5. **Answer only questions about your own records.**

A plugin author declares coverage, terms and the identifier scheme of any
subjects the plugin adds, returns the vendor's own identifiers, and implements
the connection check. Plugins never reconcile; Pythia does the matching.

## Hosting

- **Builders self-host** on an always-on machine they control, typically a
  small Linux server, and use the browser Desk from their other devices.
- **Hosting for others comes later.** Users who prefer not to self-host, and
  later teams, will be able to use a hosted workspace running the same
  software. Its form (per-team instances or a shared service) will be decided
  with the first teams.
- **Choices made now keep that open:**
  - records carry the actor who created them;
  - credentials belong to a person rather than to the process;
  - sign-in works on a server, not only on the local machine.

## Sustainability

Pythia's own source code is open under the Apache-2.0 licence, and running
Pythia never requires a subscription. The project intends to fund itself
through services that are shared and cost money to operate:

- **Free:** the application with its default plugins and a regularly updated
  prebuilt reference snapshot, sufficient to use Pythia fully.
- **Pythia Data (optional):**
  - frequent reference updates;
  - a maintained answer list and corrections as they land;
  - deep datasets built from open sources, such as fundamentals as first
    reported with their filing dates, a filings index and institutional
    holdings.

  Delivered as downloads; an entitlement is checked when downloading, never
  when running. Which of these burdens users most value having removed is to be
  established with early users before anything is charged for.
- **Hosted Pythia (later):** hosted workspaces for individuals and teams.
- **Strategy packages (later):** verified strategies that others run on their
  own installations, with their own data, models and brokers, approving their
  own trades. This will be offered only after legal review.

Model access stays bring-your-own by default, using provider terms suitable
for automated use. Bundled inference may be offered inside hosted plans.
Pythia does not resell licensed market data; licensed data stays between users
and their providers.

## What is decided and what is open

**Decided** (see [ADR 0044](decisions/0044-product-direction.md)):

- mandate-driven agents, a forward decision ledger, and money moving only with
  the owner's approval;
- local workspaces: what an investor researches stays on their machine unless
  they choose to share a fix;
- plugins introduce subjects and contribute evidence through the same contract,
  and confidence never comes from a source's name or origin;
- default plugins are preinstalled and maintained, never mandatory;
- identity, evidence and choices are handled separately;
- consequential operations require validated facts and pinned choices, while
  recording uncertainty is allowed;
- an agent's identity answer is a suggestion the user confirms, and never
  counts as a validated fact until confirmed;
- introducing a subject confers no authority over it, and the absence of other
  plugins never increases a plugin's authority.

**Open, to be validated before adopting:**

- which reference sources get direct and prebuilt forms;
- the exact rules that weigh kinds of evidence;
- keeping claims with dates of validity and of learning (bitemporal claims);
- learned source reliability and answer lists beyond Pythia's own;
- the content and pricing of optional paid services.

## Roadmap

Each stage is useful on its own.

| Stage | Goal | What it proves |
| --- | --- | --- |
| 0. Foundations | Keep plugins independent of harness internals. Queue identity questions only for instruments relevant to a holding, research task or operation. Let an ordinary plugin add a subject, contribute evidence about an existing one, appear in search, and keep saved references working through disabling, re-enabling and updates, shown with an overlapping financial source and a DeFi source. Remove authority that comes from a source's name or origin. Test the consequential failures directly: wrong share class, receipt versus ordinary share, ticker reuse, conflicting identifiers, missing currency, corporate actions and source removal, with ambiguous cases left unresolved. Give Pythia its own data directory and store | Plugins extend Pythia on equal terms, and uncertain data never silently changes what a record refers to |
| 1. Portfolio and the first paper mandate | Read-only positions from brokers and wallets. Turn a strategy conversation into a paper mandate over a manageable watchlist. Scheduled mandate runs with decisions, explicitly defined forecasts and basic scoring from the start; a paper book wherever its instrument and pricing requirements are met. A read-only yield monitor for stablecoin lending | An investor opens Pythia and sees real positions, last night's decisions with forecasts, paper performance against a benchmark, and a time-stamped ledger |
| 2. Reactive agents that are scored | Event-driven research on filings and news with deduplication and triage. A review queue. Forecast resolution and scoring against baselines. Fundamentals with filing dates, classification and market capitalisation. Alerts that need no model call | Agents react to events within minutes at a controlled cost, and their calibration can be measured |
| 3. Approved execution | Order tickets, limits and a kill switch. Broker-drafted orders the owner places. Trade-only credentials on dedicated sub-accounts. A sandboxed agent environment. Reconciliation after fills | Real orders on the owner's accounts, each traceable to a decision and an approval |
| 4. Systematic strategies | Agents propose rule-based strategies. A point-in-time history store and honest backtests that report the number of trials and known biases | New rules enter as pre-registered paper mandates |
| 5. Shareable strategies | Strategy packages with data requirements. Verifiable ledger export | Another installation runs a strategy with its own data and approvals, and verifies the author's record without seeing the author's data |

## Deliberately deferred

| Deferred | Trigger |
| --- | --- |
| Agents acting without per-trade approval | A sustained paper and approved-trade record, and an explicit decision |
| The form of the team offering, and data licensing for it | Conversations with teams once a track record exists |
| The Pythia Data subscription | Active builders using Pythia, or a dataset that is impractical to build locally |
| A separate engine service | Live automated execution, a native client, a harness replacement, or a hosted deployment |
| A plugin marketplace and a public plugin SDK | The first external plugins |
| Native macOS and Windows clients | After the web experience has stabilised |
| Replacing the agent harness | When the harness blocks a needed capability |
| New reference sources and further source audits | A strategy universe that reaches a gap, or a second user |
| Resolving every conflict in the world | Not planned: conflicts are resolved where a feature needs them |
| Process isolation for untrusted community plugins | Before an open marketplace |
