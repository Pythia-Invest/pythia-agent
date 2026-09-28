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
- **One source in onboarding at a time.** Onboarding means the audit, the
  judgement work and sign-off. The current source may change another source's
  adapter when it needs that source's evidence. It records the change in both
  records and does not widen what the other source confirms.
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

- FIRDS is onboarded first.
- **The pre-standard sources keep their current role** while they are onboarded
  in turn:
  - the builder's FIRDS, FITRS, GLEIF, SEC, OpenFIGI and ISO 10383;
  - N-CEN, which is in review;
  - the bundled plugins: coingecko, coinmarketcap, eodhd, gleif, openfigi, sec,
    xbrl-filings and yahoo-discovery;
  - the connector runners under `runtime/managed/runner/` (EODHD, CoinGecko
    and Yahoo).
- Coverage grows more slowly.
- The builder's planned move to typed claims, reconciliation and a build-time
  judge step implements stages 2 and 4.
- The gate is the source record and its review until core records trust status
  per source. Until then, a new source that has not signed off ships disabled.
  The code gate must land before the first source outside the list above is
  merged.
  A source that ships opt-in (disabled until the investor enables it) and is
  display-only (it never confirms or creates identity) complies without the code
  gate, as Hyperliquid's live view does
  ([ADR 0043](0043-live-market-view.md)).

## Rejected alternatives

- **Auditing several sources in parallel.** That is how the misread fields and
  the per-case rules accumulated.
- **Measuring quality on the hand-picked truth set.** It rewards fixing the
  names it contains.
- **Fixing odd cases with more rules.** A rule written for a named case has no
  stopping point.
- **Auto-confirming judge verdicts before calibration.** Jev scored 7%
  precision on EU depositary receipts in the gold-set evaluation.
- **Requiring a gold set for suggest-only questions.** Most of the cost for
  little safety: a suggestion is reviewed anyway.
