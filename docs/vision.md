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
portfolios and ledgers stay on a machine the investor controls. Shared truth,
such as which listing belongs to which security, is curated once and
distributed to every installation.

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
6. **Curate shared truth once.** Facts that are the same for every user are
   resolved centrally and distributed, not re-resolved on every installation.
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

### Local workspace, central truth

| Lives on the investor's machine | Curated centrally by Pythia |
| --- | --- |
| Research files, strategies, skills, mandates | Reference data: which issuer, security and listing is which, built from open registers |
| Credentials and connections to data vendors and brokers | Answers to world-level identity questions, reviewed and signed |
| Portfolio positions and transactions | Mappings from widely used vendors' symbols to subjects |
| The ledger, paper books, orders and approvals | Optional deep datasets built from open sources, such as fundamentals as first reported with their filing dates |
| Agent runs, using the investor's own model credentials | Later: hosted workspaces for users who prefer not to self-host |

Centrally curated data is delivered as signed downloads with regular updates,
not as a live query service. Pythia's services never learn which companies an
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
everything an investor holds, watches or forecasts:

- **Subject identifiers never disappear.** They survive rebuilds, renames and
  corporate actions through aliases and successor links. A forecast made today
  must still resolve years from now.
- **Holdings come first.** A position or record that Pythia cannot match to an
  open identifier still appears, labelled as unmatched, instead of being
  dropped.
- **New kinds of subject are added when a strategy needs them,** for example
  DeFi protocols and pools, or sector classification and market capitalisation.
- **Coverage breadth grows with demand.** New reference sources are added when
  a strategy's universe reaches a gap, not in advance.

### Where conflicts are resolved

The rule: solve once where the answer is the same for everyone, solve lazily
where it is private, and never "solve" what is legitimately different.

| Conflict | Example | Where and when | What the user sees |
| --- | --- | --- | --- |
| World identity | Which listing is a company's home market; a register pointing a receipt at the wrong share | Centrally, at build time. Rules and typed claims come first, then AI-assisted review, then maintainer approval. Answers ship in the signed reference package | Nothing to do. At most an "unknown" label, with a local override |
| Vendor symbols | Mapping a vendor's ticker to a listing | Centrally for widely used vendors. For others, automatic matching by open identifiers when the plugin connects | A summary of what matched, and what stays available only from that vendor |
| The user's own unmatched records | A broker position or wallet token that the reference does not know | On the user's machine, only when it matters (held, watched, opened or forecast). An agent proposes a match and the user confirms | The record appears immediately, labelled "not matched", with a one-click suggestion |
| Values that differ | Two vendors reporting different revenue | Never resolved: single values are shown side by side and lists are merged without duplicates; a price view uses one source ([ADR 0040](decisions/0040-data-concepts-and-agent-tools.md)) | Labelled rows. A forecast fixes its resolution source in advance |
| A source changes | A vendor alters a field | Detected by drift alarms and fixed by the plugin's maintainer | "Source changed, fix pending". Affected views show stale labels, never wrong data |
| Plan limits | A key that covers end-of-day data but not intraday data | The plugin's connection check records what the credential allows | An inspectable connection result. Selection skips what is not covered |

Users never answer world-level questions. They confirm matches for their own
records and see differences as labels.

- **Local fixes can flow back** to the central reference by explicit opt-in per
  fix. Only the identifiers and the reasoning are sent, never positions or
  holdings.
- **When a user's own vendor disagrees with the reference,** the reference is
  the default, the disagreement is shown, and a one-click local override makes
  the user's choice win on their installation.

### Plugin trust levels

| Level | May | Requires |
| --- | --- | --- |
| Display | Provide data that is shown with its source | Declared coverage and terms |
| Suggest identity | Propose identity links for review | Documented field semantics |
| Confirm identity | Create or confirm identity links | The full [source onboarding](architecture/source-onboarding.md) audit and sign-off |

A plugin that only displays data, including a user's own licensed vendor, needs
no audit. That keeps community plugins cheap to write and a user's paid data
fully usable.

### Connecting a plugin

1. **Install or enable the plugin.** Its card shows its trust level and its
   provider's terms.
2. **Add a credential.** The connection check shows what the plan allows and
   how much of the vendor's universe matched existing subjects.
3. **Choose placement.** Choose whether the source comes first for the kinds of
   data it serves, or complements the free defaults.
4. **Use it.** Its data appears labelled by source, for people and agents
   alike.
5. **Answer only questions about your own records.**

A plugin author declares coverage and terms, returns the vendor's own
identifiers, and implements the connection check. Plugins never reconcile;
Pythia does the matching.

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

- **Free:** the application and a regularly updated reference snapshot,
  sufficient to use Pythia fully.
- **Pythia Data (optional):**
  - frequent reference updates;
  - curated corrections as they land;
  - deep datasets built from open sources, such as fundamentals as first
    reported with their filing dates, a filings index and institutional
    holdings.

  Delivered as downloads; an entitlement is checked when downloading, never
  when running.
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
| 0. Foundations | Complete in-flight identity work within the scope above. Give Pythia its own data directory and store. Keep plugins independent of harness internals. Record this direction in the product documentation | The ground is ready without new infrastructure |
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
| Native macOS and Windows clients | After the web experience has stabilised |
| Replacing the agent harness | When the harness blocks a needed capability |
| New reference sources and further source audits | A strategy universe that reaches a gap, or a second user |
