# 0042: Source onboarding standard

## Context

The identity backbone ([ADR 0037](0037-identity-backbone.md)) builds identity
from open reference sources and provider plugins. To get the structure right,
the reference builder took in five sources at once: FIRDS, GLEIF, SEC,
OpenFIGI and ISO 10383. An audit and a root-cause analysis in September 2026
found systematic errors, each affecting thousands of rows.

- **Misread fields.** Three FIRDS fields were used with the wrong meaning:
  - the notional currency was taken as the trading currency;
  - "issuer or venue operator" was taken as the issuer;
  - the most liquid market was taken as the home market.

  Meanwhile the field that records which admissions the issuer requested was
  never read.
- **Evidence thrown away.** The first value won, and the evidence against it
  was discarded, so disagreements never became visible.
- **Per-case rules.** The builder grew hand lists, tie-breaks and name
  heuristics. Each one fixed its named examples and moved errors elsewhere.
- **A misleading score.** A hand-picked truth set scored 98% while hundreds of
  rows in the same build were wrong.

The founder's direction: implement data sources one by one, audit each in full,
build each integration defensively so a change in the source is noticed, and
use a classifier such as Jev for the cases that need human judgement, checking
its final output during development. It is time-intensive, and it is the only
way to get data we can trust.

## Ruling

- **Six stages for every source.** Every data source, whether a reference
  source or a provider plugin, is onboarded through six stages, each with exit
  criteria:
  1. field semantics with citations;
  2. a defensive adapter that emits typed claims;
  3. drift detection;
  4. a full data audit;
  5. judgement cases defined as question types;
  6. sign-off.

  [Source onboarding](../architecture/source-onboarding.md) defines them. Each
  source keeps a public record in `docs/sources/<source>.md`.
- **One source at a time.** Adapter work on the next source starts after the
  current one signs off.
- **Not trusted until sign-off.** Until then, a source does not auto-confirm
  identity and is not a default: it is not enabled by default and is not the
  default source for any section.
- **Judgement goes through calibrated question types.** Each type has:
  - a versioned question set;
  - a gold set with a frozen dev and test split;
  - a threshold per relation, or a suggest-only status;
  - a development-time check of final outputs.

  Auto-confirmation requires a Wilson 95% lower bound of at least 99% on test,
  and every verdict passes through core's `decide()`.
- **Where the material lives.** Question sets and the eval harness are public
  source. Gold labels on licensed data, raw model exchanges and verdicts stay
  on the device and are not committed.

## Rationale

A field read in the wrong meaning corrupts every row at once, and only
checking against the specification catches it. A random sample measures the
error rate; a list of famous names does not. A fingerprint turns a silent
change at the provider into an alarm. A classifier helps only where its
precision has been measured on the question it is actually asked.

## Consequences

- FIRDS is onboarded first. Its record starts from the root-cause findings.
- The sources in use before this decision keep their current role while they
  are onboarded in turn. No change may widen what they confirm before they
  sign off.
- Coverage grows more slowly. A new provider plugin waits for the current
  onboarding to finish.
- The reference builder's planned move to typed claims, reconciliation and a
  build-time judge step is how stages 2, 3 and 5 are implemented.
- For now the gate is the source record and its review. Recording each
  source's trust status in code, so that core refuses confirmation from an
  untrusted source, is follow-up work.

## Rejected alternatives

- **Onboarding several sources in parallel.** This is how the misread fields
  and per-case rules accumulated.
- **Measuring quality on the hand-picked truth set.** It rewards fixing the
  names it contains and says nothing about the other rows.
- **Fixing odd cases with more rules.** A rule written for a named case has no
  stopping point.
- **Auto-confirming judge verdicts before calibration.** The measured Jev
  precision on some hard strata, for example 7% on EU depositary receipts,
  rules this out without a gold set for each question type.
