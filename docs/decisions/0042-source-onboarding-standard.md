# 0042: Source onboarding standard

## Context

The identity backbone ([ADR 0037](0037-identity-backbone.md)) builds identity
from open reference sources and provider plugins. To get the structure right,
the reference builder took in five sources at once. An audit and a root-cause
analysis in September 2026 then found systematic errors, each touching
thousands of rows.

- **Misread fields.** Three FIRDS fields were used in the wrong meaning:
  - the notional currency was taken as the trading currency;
  - "issuer or venue operator" was taken as the issuer;
  - the most liquid market was taken as the home market.

  The field recording which admissions the issuer requested was never read.
- **Evidence thrown away.** The first value won and the rest was discarded, so
  disagreements never became visible. Every derived value was written with
  `snapshot` authority.
- **Per-case rules.** Hand lists, tie-breaks and name heuristics fixed their
  named examples and moved the errors elsewhere:
  - an ISIN-country list of home venues put Chubb on SIX;
  - a shortest-ticker tie-break gave Société Générale's Stuttgart line `GLE`,
    which is also Gladstone Commercial's ticker there.
- **A misleading score.** A hand-picked truth set scored 98% while hundreds of
  rows in the same build were wrong.

The founder's direction:

- implement sources one by one, with a full audit of each;
- build each integration defensively, so a change at the source is noticed;
- use a classifier such as Jev for the cases that need human judgement, and
  check its final output during development.

It takes time, and it is the only way to get data we can trust.

## Ruling

- **Four stages and a sign-off gate.** Every data source goes through them,
  each with exit criteria. [Source onboarding](../architecture/source-onboarding.md)
  defines them:
  1. field semantics with citations;
  2. a defensive adapter with drift alarms;
  3. a full data audit;
  4. judgement cases.

  Sign-off follows as a gate.

  Each source keeps a public record in `docs/sources/<source>.md`.
- **One audit per source, never batched.** Onboarding means the audit, the
  judgement work and sign-off. Several sources may be in onboarding at once
  (amended 2026-09-28, below), each with its own pull request, record, audit and
  sign-off. A source in onboarding may change another source's adapter when it
  needs that source's evidence. It records the change in both records and does
  not widen what the other source confirms.
- **Not trusted until sign-off.** Until then, a source does not create or change
  identity bindings, subjects or relations without review. It is also not
  enabled by default, and it is not the default source for any section.
- **Authority follows derivation.** Only a value read directly from a source
  field carries `snapshot` authority. A rule output, a default or a model
  answer carries its own.
- **Judgement.** Every question type:
  - has a versioned question set;
  - passes its verdicts through core's `decide()`;
  - has a development check of final outputs.

  Without more, it only suggests. Auto-confirmation also needs a gold set per
  relation with a frozen dev/test split, and a test precision whose Wilson 95%
  lower bound is at least 99%.
- **Where the material lives.** Question sets and the eval harness are public
  source. Gold labels on licensed data, raw model exchanges and verdicts stay on
  the device.

## Rationale

A field read in the wrong meaning corrupts every row at once, and only checking
against the specification catches it. A random sample measures the error rate;
a list of famous names does not. A fingerprint turns a silent change at the
source into an alarm. A classifier helps only where its output has been checked
on the question it is actually asked, and it may confirm only where its
precision has been measured.

## Consequences

- FIRDS was onboarded first.
- **The pre-standard sources keep their current role** while they are onboarded:
  - the builder's FIRDS, FITRS, GLEIF, SEC, OpenFIGI and ISO 10383;
  - N-CEN, which is in review;
  - the bundled plugins: coingecko, coinmarketcap, eodhd, gleif, openfigi, sec,
    xbrl-filings and yahoo-discovery;
  - the connector runners under `runtime/managed/runner/` (EODHD, CoinGecko
    and Yahoo).
- Coverage grows more slowly.
- The builder's planned move to typed claims, reconciliation and a build-time
  judge step implements stages 2 and 4.
- **The code gate is built.** Each plugin's `contract.json` declares its
  `signoff`: `signed_off` with its record, `grandfathered`, or `unsigned`. The
  bundled plugins above are `grandfathered`, each pointing at its pending
  record in `docs/sources/`. The builder's reference sources are not plugins;
  their record and its review remain their gate. A plugin cannot vouch for
  itself: core honours `signed_off` or `grandfathered` only from the plugins
  Pythia bundles and treats every other plugin as `unsigned`, whatever its
  contract says. For an `unsigned` source:
  - a fresh profile never enables it, even if its payload lists it as enabled
    by default;
  - core's order never ranks it ahead of an audited source, so it serves a
    section only when the investor names it in `source_order` or nothing
    audited can serve;
  - a resolve answer that would bind becomes an `unaudited` residual, with the
    matching evidence, for the investor to review; the agent's answer to it
    only suggests;
  - pages, alternatives, filings results and market-data reads mark it
    unaudited, which the Desk shows as "not yet audited".

  The investor may still enable it; turning it on is the opt-in. A source that
  ships opt-in and is display-only (it never confirms or creates identity), as
  Hyperliquid's live view does ([ADR 0043](0043-live-market-view.md)), may ship
  before sign-off as `unsigned`.

## Rejected alternatives

- **Auditing several sources together.** One build that took in five sources
  at once, with one shared audit, is how the misread fields and the per-case
  rules accumulated. Separate audits running at the same time are allowed
  (amendment below); a combined one is not.
- **Measuring quality on the hand-picked truth set.** It rewards fixing the
  names it contains.
- **Fixing odd cases with more rules.** A rule written for a named case has no
  stopping point.
- **Auto-confirming judge verdicts before calibration.** Jev scored 7%
  precision on EU depositary receipts in the gold-set evaluation.
- **Requiring a gold set for suggest-only questions.** Most of the cost for
  little safety: a suggestion is reviewed anyway.

## Amendment (2026-09-28): several sources in onboarding at once

**Context.** The original ruling allowed one source in onboarding at a time.
FIRDS then held the slot while the SEC, filings.xbrl.org, Yahoo and the national
regulators waited behind it, although their audits share no work with FIRDS.

**Ruling.** The founder's ruling, 2026-09-28 (decision C5): "just continue and
parallelize what we can. But use a healthy amount of resources."

- Several sources may be in onboarding at the same time.
- Each has its own pull request, source record, audit and sign-off. Sources are
  never batched into one audit, one record or one sign-off.
- A source in onboarding may still change another source's adapter only when it
  needs that source's evidence, recorded in both records.
- Parallel work stays proportionate: audits are scripted over cached data, and
  labelling is limited to the random sample.

**Rationale.** The errors this standard answers came from one shared audit of
five sources, not from audits running side by side. A separate record, sample
and sign-off per source keep each source's odd cases visible.

**Consequences.** `docs/architecture/source-onboarding.md` says the same. A
source's record names the other sources whose open work it depends on (the
SEC's CIK links depend on FIRDS field 5), and its sign-off does not wait for
theirs unless it confirms through their evidence.

## Amendment (2026-09-29): trust levels and curated answers

[ADR 0044](0044-product-direction.md) sets three plugin trust levels: display,
suggest identity and confirm identity. Displaying data and adding subjects in
the plugin's own domain need declared coverage, terms and identifier scheme.
Establishing facts about subjects that other sources also describe requires
this standard's full audit and sign-off. A user's own licensed vendor is usable
at the display level.

Reviewed answers over open data may ship in the reference package. Gold labels
on licensed data and raw model exchanges stay on the device. Further source
audits are paused until a strategy's universe or a second user needs them.
