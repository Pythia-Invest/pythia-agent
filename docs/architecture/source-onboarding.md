# Onboarding a data source

A data source supplies investment evidence. It is either a reference source read
by the reference builder (FIRDS, GLEIF, SEC, OpenFIGI, ISO 10383) or a provider
plugin (Yahoo, EODHD, CoinGecko, IBKR). Core turns that evidence into identity,
so one misread field reaches every row at once.

We trust a source only when all of these hold:

- we know what each of its fields means;
- we will notice when it changes;
- we have measured its error rate on random rows;
- we have checked that its judgement cases come out right.

This page is the standard. [ADR 0042](../decisions/0042-source-onboarding-standard.md)
records the decision. Each source keeps a record in `docs/sources/<source>.md`,
copied from the [template](../sources/template.md). [FIRDS](../sources/firds.md)
is the first.

**When the stages apply:**

- adding a source;
- reading a new field from a source;
- adding a judgement question type;
- widening what a source may confirm.

Routine maintenance of a source that has not been onboarded yet does not start
its onboarding.

## One source at a time

- **Only one source is in onboarding at a time.** Onboarding here means the
  audit, the judgement work and sign-off. Each source has its own odd cases,
  and only a full audit finds them.
- **The current source may change another source's adapter** when it needs that
  source's evidence. For example, FIRDS needs the operator LEIs from ISO 10383.
  Record the change in both source records. It must not widen what the other
  source confirms.

**What "confirm" means.** To confirm is to create or change an identity binding,
subject or relation without review. A source that has not signed off:

- does not confirm;
- is not enabled by default in fresh profiles;
- is not the default source for any page section.

Until core records each source's trust status, a new source that has not signed
off ships disabled. That code gate must land before the first source outside
the pre-standard list is merged. The sources in use before this standard are
listed in ADR 0042. They keep their current role while they are onboarded in
turn, starting with FIRDS.

## Stages

### 1. Field semantics

For every field the adapter reads, record:

- the official definition, with a citation to the specification, field number
  or Q&A;
- the one meaning Pythia gives it;
- its measured behaviour: values per identifier, null and placeholder rates, and
  vocabulary.

Also list the unread fields that could answer a question we ask, and any
announced change to the specification.

**Exit:**

- every field that is read has a citation and exactly one meaning;
- every gap between the measured behaviour and the definition is an odd case.

### 2. A defensive adapter with drift alarms

**Claims.** The adapter emits claims keyed by a global identifier. Each claim
carries:

- a meaning from core's vocabulary (`notional_currency`, not `currency`);
- the source field;
- the as-of date;
- a record digest.

**Behaviour.** The adapter never picks a winner and never reads another source.
It records an empty answer as absence, not as a negative fact.

**Authority.** Only a value read directly from a source field carries
`snapshot` authority. Every derived value carries its own:

- a rule output is `rule_confirmed`, with its `rule_id`;
- a venue default must not use `curated` or `snapshot`: until core has a
  default authority, write it as an unconfirmed attribute or leave it out;
- a judge answer is `model_*`.

A derived value must never gain T0 authority over a provider's identifier.

**Unexpected input** is counted, never coerced:

- unknown codes;
- malformed identifiers;
- placeholders;
- missing elements.

**Fingerprint.** Each build records a fingerprint in the manifest and compares
it with the last good build. It covers:

- the element set and vocabularies;
- null and placeholder rates;
- the per-identifier value counts from stage 1;
- answer rates;
- record counts per segment.

A structural break fails that source's stage and keeps the last good build
([ADR 0031](../decisions/0031-connector-execution-and-visible-failures.md),
[ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)). A
shift past its threshold is reported with examples.

**Live connectors** have no builds. For one, the connector checks each response
against the expected schema and vocabulary instead.

Builds run on users' devices, so maintainer builds must see an alarm first.
Users see the visible stage failure.

**Tests** are network-free and use synthetic fixtures that cite the
specification. They cover each field, each odd case, and one changed input that
trips an alarm.

**Exit:**

- every stage 1 field has a parse, a counter and a fingerprint check;
- no field feeds two meanings.

The reference builder emits claims for FIRDS, in shadow mode
(`tooling/reference-builder/reference_builder/claims.py`); its other sources do
not yet. Until a source does, carry each meaning in names and types in the same
way.

### 3. A full data audit

**Random sample.**

- Draw a stratified random sample over the source's natural dimensions, for
  example kind × venue type × region, and freeze it with a seed.
- Label each field against a primary source, such as the exchange or the
  issuer's filings.
  - Never label a field against the audited source, or against a value derived
    from it.
  - Another build input may serve only as the registry for its own identifier:
    GLEIF for the LEI, the SEC for the CIK.
- Publish per-field precision with Wilson 95% bounds.

**Truth set.** A hand-picked truth set is a regression suite, not the quality
measure. Never edit an entry to match a build.

**Invariants** run on every build as smoke alarms.

- They encode a standard or a logical rule, not a name pattern. For example, a
  withdrawn ISO 4217 code, or one ticker naming two securities on one venue.
- They never change data.
- Their limit is 0, or a ratchet only while a named fix is under way.

**Odd cases.** List every odd case in the source record with:

- its count, with the unit;
- an example;
- an explanation;
- its handling: adapter, precedence rule, judgement question or accepted limit.

For a live connector, the maintainer probes the sample periodically.

**Exit:**

- the precision figures are published;
- every odd case is explained or marked open;
- no limit accepts a known error without a named fix.

### 4. Judgement cases

Some cases need judgement that no field settles. For example: is this LEI the
issuer, a subsidiary, or unrelated? Each such case becomes a question type,
answered by a resolver plugin such as Jev
([ADR 0037](../decisions/0037-identity-backbone.md)).

Code handles the other hard cases:

- comparisons, dates, counts and identifier agreement belong in code;
- a question answerable only from memory stays unknown or goes to Repairs.

**Every question type needs:**

- a versioned question set;
- verdicts that pass through core's `decide()`;
- a development check. Run the judge on a sampled build, inspect the final
  written values rather than the verdict scores, and record the error rate.

Without more, a question type is **suggest-only**: `model_suggested`, and the
answers go to Repairs.

**Auto-confirm (`model_confirmed`) also needs** a gold set per relation:

- stratified, including hard strata and negatives;
- split into dev and test, and frozen before any tuning;
- with a threshold fitted on dev whose test precision has a Wilson 95% lower
  bound of at least 99%. With no errors, that takes about 385 assertions.

**Exit:** every residual class is assigned to code, a question type or Repairs,
and each question type has its development check recorded.

### Sign-off

Sign-off is a reviewed pull request that sets the record's status to `trusted`.
It is approved by the project maintainer and cites:

- the evidence for each stage;
- the measured builds and sample;
- the date.

Every open item is closed, or accepted with a limit and an owner.

Any of these reopens the affected stage and suspends trust in the affected
fields until it passes again:

- a drift alarm;
- a change to the specification;
- a new field use;
- a new question type.

## Good and bad adapter code

**Good code** encodes a documented meaning or a standard, is general, and still
holds when new data arrives. Examples:

- **A field read as the standard defines it.** RTS 23 field 5 is the "LEI of
  issuer or trading venue operator", so it is emitted as
  `issuer_or_venue_operator_lei`. When ISO 10383 lists the LEI as a venue
  operator's, the issuer stays unknown and a question opens. No names are
  compared.
- **A standard parsed.** A share class read from the ISO 18774 FISN.
- **An identifier join.** Rows joined on a shared composite FIGI.

**Bad code** hides what the evidence says. Examples:

- **A hand list standing in for an unread field.** An ordered list of "home"
  venues keyed by ISIN country moved shares away from the only listing their
  issuer requested.
- **A tie-break that hides ambiguity.** When two securities claim one ticker on
  one venue, sorting by the shortest ticker picks one silently. Two claimants
  are a conflict to show.
- **A name heuristic used as identity.** For example, spotting a financing
  vehicle by a name pattern, or linking an issuer through a unique normalised
  name. Use GLEIF Level 2 relationships or a judgement question instead. Names
  may be judge features or alarm descriptions, never identity.

A rule written for a named case has no stopping point. It fixes its own examples
and moves the errors elsewhere.

## Where judgement material lives

**Public source:**

- **Question sets.** Each is versioned as `<question>@<n>` and has one owner:
  the resolver plugin that asks it at runtime, or
  `tooling/reference-builder/judge/` for a question asked only at build time.
  The builder imports a shared question from its owner instead of copying it.
  The version enters every verdict's input digest.
- **The eval harness** (scorer, calibrator and threshold selection), placed
  beside the question sets. Its tests use synthetic rows.
- **Gold labels built only from open identifiers** whose terms permit
  reproduction. They may be committed, like the truth set.

**Never committed.** These stay on the device (`.local/`) or in private working
records:

- gold labels on licensed provider rows;
- raw model requests and responses;
- verdicts.

The reasons are provider terms, the repository rule against committing provider
responses and model output, and
[ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md).

**The source record holds the evaluation summary:**

- the gold manifest: strata, sizes, seed, split and hash;
- the labelling protocol;
- the model and question versions;
- the thresholds;
- precision with its bounds;
- the development check.

## Writing judgement questions

Follow the [prompting guidance](../prompting.md). For Jev in particular:

- **Pin the model version.** A new model version, wording or evidence rendering
  is a new question version and needs a new calibration.
- **Give every option a positive criterion.** Include `none` and `several`,
  keep candidates closed-world, and pass names and identifiers as data.
- **Send only the evidence the question needs.** Irrelevant state degrades the
  answers.
- **Calibrate per question and per relation.** Never reuse a threshold across
  question types or forms. Put the calibrated option probability in the
  verdict's `confidence`.
- **Tune only on dev.** A wording fix prompted by errors seen on test needs a
  fresh test split before its numbers count.
- **Let mechanical guards win.** The depositary-receipt, share-class and
  identifier-contradiction guards override the model.
- **Use made-up values in examples.**
