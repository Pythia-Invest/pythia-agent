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

Pythia is open, local-first and pluggable. Research, strategies, credentials,
portfolios and ledgers stay on a machine the investor controls. Every data
source, including the official registers that establish which listing belongs
to which security, is a plugin that integrates against a shared,
vendor-independent backbone. There is no central authority: prebuilt data and
curated answers are optional conveniences that anyone can publish and every
user can replace.

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
6. **A shared protocol, pluggable sources.** Core defines the backbone: subject
   kinds, identifier rules, the claim format, a deterministic resolver and open,
   versioned default rules. Every source is a plugin that contributes claims
   against it. Plugins add the subjects and data of their own domains freely.
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

### Local workspace, pluggable sources

Everything that belongs to the investor stays on their machine: research
files, strategies, skills and mandates; credentials; portfolio positions and
transactions; the ledger, paper books, orders and approvals; and agent runs,
which use the investor's own model credentials.

Data enters through plugins. The core defines the protocol: subject kinds,
identifier rules, the claim format, a deterministic resolver that turns the
claims of all enabled plugins into subjects and relations, and open, versioned
default rules. Plugins only contribute claims; they never reconcile, and they
never override the resolver.

Each plugin runs in the mode that suits its source:

| Mode | How it works | Examples |
| --- | --- | --- |
| Direct | The plugin fetches and indexes its source on the investor's machine | Official registers such as ESMA FIRDS, GLEIF and the SEC's company data, and vendors used with the investor's own credentials |
| Prebuilt | The same plugin's output is built elsewhere and downloaded as a signed cache, where the source's terms allow it. Anyone can publish such a cache; the investor chooses which to trust, or builds directly instead | Sources that are slow to build locally, such as a full OpenFIGI mapping |
| On demand | The plugin reads its source when data is needed | Per-symbol market data, on-chain data |

Prebuilt caches and curated datasets are delivered as downloads with regular
updates, not as a live query service. No service learns which companies an
investor looks at, because for an investment team that is its edge. An
installation keeps working offline.

### Ownership of the engine

- **Pythia owns its domain engine and its state:** subjects and sources,
  mandates and guard, the ledger, portfolio, jobs, order tickets and approvals.
  Its stores live in Pythia's own data directory.
- **An agent harness runs agent turns.** Today this is Hermes, behind a single
  adapter, which keeps the harness replaceable. Plugins use a small, versioned
  Pythia platform interface and never import harness internals.
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

### The role of identity

The identity backbone ([ADR 0037](decisions/0037-identity-backbone.md)) is the
foundation that lets many plugins connect without every pair of sources needing
its own mapping. Its job from here is to be a permanent address book for
everything an investor holds, watches or forecasts, whichever plugin it comes
from.

**Core owns the rules; plugins contribute the contents.** Core defines a small
set of subject kinds (such as issuer, security, listing, index, data series,
protocol and pool), the rules for forming identifiers, the relations between
subjects, and the matching engine. Plugins add subjects within those kinds.
This follows the model of home-automation platforms such as Home Assistant:
integrations add any number of devices, but within a fixed set of entity types,
which is why the interface and automations work generically across all of them.
A genuinely new kind is a rare addition to core. New subjects never are.

- **Any plugin can add subjects.** A plugin for over-the-counter stocks adds
  those stocks under their ISINs. A plugin for a DeFi ecosystem adds its
  protocols, pools and tokens under their on-chain identifiers. Because
  identifiers are derived from open or native identifiers, every installation
  with that plugin arrives at the same identifiers, so these subjects are
  first-class: they get pages, can be watched, forecast and held, and appear in
  the ledger like any listed security. No source is a gatekeeper of what
  exists.
- **A plugin is the authority for its own domain.** Facts about subjects that
  other sources also describe are different: for example, which company a
  ticker belongs to, which listing is a company's home market, or which share
  a depositary receipt represents. A plugin can suggest such facts. Confirming
  them requires the audited trust level below.
- **Links into the shared backbone happen by identifier agreement.** When a
  DeFi pool's underlying token is the same on-chain asset as a stablecoin that
  another plugin already describes, the link is made automatically. Anything
  ambiguous becomes a suggestion, raised only when it matters.
- **Identifiers come from identifiers, not from sources.** A subject's
  identifier is derived from open identifiers such as an ISIN, a share-class
  FIGI, an LEI or an on-chain address. Any enabled plugin that supplies the
  same identifier leads to the same subject, so two installations with
  different plugins agree wherever their evidence overlaps.
- **Defaults are preinstalled, never mandatory.** Pythia ships with a default
  set of open reference plugins enabled. Disabling one reduces the universe
  it covers. Where it supplied the identifier that keys a segment of the
  market, that segment falls back to temporary identifiers. For example,
  United States and Canadian securities are keyed by share-class FIGI, because
  their ISINs are licensed. Enabling a source later re-keys temporary
  identifiers through aliases.
- **Shared artefacts carry identifier bundles.** A strategy package or ledger
  export lists every known identifier for each subject, not only Pythia's
  identifier, and records the version of the default rules it used. The
  receiving installation resolves them against its own plugins.
- **Subject identifiers never disappear.** They survive rebuilds, renames and
  corporate actions through aliases and successor links. A forecast made today
  must still resolve years from now.
- **Holdings come first.** A position or record that no source can identify
  still appears, labelled as unmatched, instead of being dropped.
- **Coverage grows with plugins.** New reference plugins are added when a
  strategy's universe reaches a gap. Exotic domains are covered by their own
  plugins.

### Where conflicts are resolved

Most apparent conflicts are not conflicts. In an analysis of a full reference
build over EU and United States securities, 86% of the open identity questions
were missing evidence: one source could not see something another open source
states. Many more were errors in a single source, such as stale identifiers
after corporate actions. Only about 0.4% needed judgment, all of them the
question of which of two real listings is a company's primary one. The rule
that follows: combine the evidence of all enabled plugins with deterministic
rules first, handle the rare genuine cases with optional answer lists, and
never "solve" what is legitimately different.

| Conflict | Example | Where and when | What the user sees |
| --- | --- | --- | --- |
| Missing evidence | A register sees only the German trading lines of a foreign share, while another source knows its home exchange | On the user's machine: the resolver combines the claims of all enabled plugins | Nothing to do |
| Source errors | A stale identifier after a share consolidation; a register field naming the wrong company | Deterministic rules and lifecycle data, versioned in the default rules | Nothing to do |
| Genuine judgment | Which of two listings is the primary one for a company listed in two countries | Answer lists: a published list of answers, or the user's own. When the lists a user trusts disagree, the answer stays "unknown" | An "unknown" label, or the answer from a trusted list, with a local override |
| A plugin's own domain | DeFi pools and protocols; a vendor's proprietary indices | Nowhere: the plugin is the authority for its own subjects. Links to shared subjects, such as a pool's underlying stablecoin, are made by identifier agreement or suggested | New subjects appear with the plugin's label |
| Vendor symbols | Mapping a vendor's ticker to a listing | Automatic matching by open identifiers when the plugin connects. Mappings for widely used vendors may be published as a prebuilt cache | A summary of what matched, and what stays available only from that vendor |
| The user's own unmatched records | A broker position or wallet token that the reference does not know | On the user's machine, only when it matters (held, watched, opened or forecast). An agent proposes a match and the user confirms | The record appears immediately, labelled "not matched", with a one-click suggestion |
| Values that differ | Two vendors reporting different revenue | Never resolved: single values are shown side by side and lists are merged without duplicates; a price view uses one source ([ADR 0040](decisions/0040-data-concepts-and-agent-tools.md)) | Labelled rows. A forecast fixes its resolution source in advance |
| A source changes | A vendor alters a field | Detected by drift alarms and fixed by the plugin's maintainer | "Source changed, fix pending". Affected views show stale labels, never wrong data |
| Plan limits | A key that covers end-of-day data but not intraday data | The plugin's connection check records what the credential allows | An inspectable connection result. Selection skips what is not covered |

Users are not asked world-level questions. They confirm matches for their own
records and see differences as labels.

- **Default rules are open and forkable.** A handful of definitions and
  precedence rules decide the common cases. Examples: whether a company's
  registered filings beat a trading venue's field for its issuer, whether two
  listings can both be primary, and whether a depositary receipt counts as
  exposure to its underlying share. They are published, versioned and
  changelogged, and a user can override them locally.
  - Overrides that affect only display, such as which listing prices by
    default, are safe to diverge.
  - Facts a mandate reads, such as issuer grouping for position limits, must
    match wherever a strategy runs. A shared strategy therefore records the
    rule version it was evaluated under.
- **Answer lists are plugins too.** Pythia may publish a default list, others
  may publish theirs, and a user may keep their own. None is mandatory.
- **Local fixes can be shared** with the maintainers of a list or plugin by
  explicit opt-in per fix. Only the identifiers and the reasoning are sent,
  never positions or holdings.
- **When a user's own vendor disagrees with the default evidence,** the
  default holds, the disagreement is shown, and a one-click local override
  makes the user's choice win on their installation.

### Plugin trust levels

| Level | May | Requires |
| --- | --- | --- |
| Display | Provide data that is shown with its source, and add subjects in its own domain under open or native identifiers | Declared coverage, terms and identifier scheme |
| Suggest identity | Propose facts about shared subjects for review | Documented field semantics |
| Confirm identity | Establish facts about shared subjects without review | The full [source onboarding](architecture/source-onboarding.md) audit and sign-off |

Adding subjects and data needs no audit, so community plugins are cheap to
write and a user's own paid data is fully usable. The audit is reserved for
overruling or establishing facts that other sources also describe.

- **What a plugin's claims can establish is bounded by claim type and trust
  level.** A plugin cannot give its own claims more authority by labelling
  them.
- **Trust attaches to a plugin's content, not its name.** Trust is tied to a
  signed or hashed release, so a different plugin that reuses an audited
  plugin's name does not inherit its trust level. Trust levels and the
  choice of answer lists stay under the user's control.
- **Trust levels limit what data can do, not what code can do.** Running
  untrusted community code safely also requires isolating plugins, which is
  planned before an open marketplace.

### Connecting a plugin

1. **Install or enable the plugin.** Its card shows its trust level and its
   provider's terms.
2. **Add a credential.** The connection check shows what the plan allows, how
   much of the vendor's universe matched existing subjects, and which new
   subjects the plugin adds.
3. **Choose placement.** Choose whether the source comes first for the kinds of
   data it serves, or complements the free defaults.
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

- **Free:** the application with its default plugins, which can build their
  data directly, plus a regularly updated prebuilt cache of the default
  plugins, sufficient to use Pythia fully.
- **Pythia Data (optional convenience, never an authority):**
  - frequent prebuilt updates;
  - a maintained answer list;
  - deep datasets built from open sources, such as fundamentals as first
    reported with their filing dates, a filings index and institutional
    holdings.

  Delivered as downloads; an entitlement is checked when downloading, never
  when running. Everything it provides could also be built or answered
  locally.
- **Hosted Pythia (later):** hosted workspaces for individuals and teams.
- **Strategy packages (later):** verified strategies that others run on their
  own installations, with their own data, models and brokers, approving their
  own trades. This will be offered only after legal review.

Model access stays bring-your-own by default, using provider terms suitable
for automated use. Bundled inference may be offered inside hosted plans.
Pythia does not resell licensed market data; licensed data stays between users
and their providers.

## Roadmap

Each stage is useful on its own.

| Stage | Goal | What it proves |
| --- | --- | --- |
| 0. Foundations | Complete in-flight identity work within the scope above. Make the reference sources claim-emitting plugins with direct and prebuilt modes. Tie trust to plugin content. Correct identifier rules before any ledger depends on them. Give Pythia its own data directory and store. Keep plugins independent of harness internals. Record this direction in the product documentation | The backbone is pluggable end to end, without new infrastructure |
| 1. Portfolio and the first paper mandate | Read-only positions from brokers and wallets. Turn a strategy conversation into a paper mandate. Scheduled mandate runs with decisions, forecasts and a paper book. A read-only yield monitor for stablecoin lending | An investor opens Pythia and sees real positions, last night's decisions with forecasts, paper performance against a benchmark, and a time-stamped ledger |
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
| Process isolation for untrusted community plugins | Before an open marketplace |
| Native macOS and Windows clients | After the web experience has stabilised |
| Replacing the agent harness | When the harness blocks a needed capability |
| New reference plugins and further source audits | A strategy universe that reaches a gap, or a second user |
