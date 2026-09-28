# Onboarding a data source

A data source is anything that supplies investment evidence: a reference source
read by the reference builder (FIRDS, GLEIF, SEC, OpenFIGI, ISO 10383) or a
provider plugin (Yahoo, EODHD, CoinGecko, IBKR). Core turns that evidence into
identity and pages show it, so a misread field reaches every row at once. We
trust a source only when four things hold:

- we know what each field means;
- we will notice when the source changes;
- we have measured its error rate on random rows;
- we have checked that the cases needing judgement come out right.

This page is the standard, and [ADR 0042](../decisions/0042-source-onboarding-standard.md)
records the decision. Each source keeps its record in `docs/sources/<source>.md`,
copied from the [template](../sources/template.md). [FIRDS](../sources/firds.md)
is the first.

## One source at a time

Onboard sources one at a time. Adapter work on the next source starts after the
current one signs off. Each source has its own odd cases, and only a full audit
finds them. Doing several at once is how the reference builder came to misread
fields and pile up per-case rules.

A source is not trusted until it signs off. Until then:

- its evidence may be ingested and shown with its provenance;
- it does not auto-confirm identity: its matches go to the resolution queue as
  suggestions, and no rule or judgement question built on it confirms without
  review;
- it is not enabled by default in fresh profiles, and it is not the default
  source for any page section.

The sources in use before this standard are the one exception: they keep their
current role while they are onboarded in turn, starting with FIRDS. A change must not widen what a source
may confirm before that source signs off.

## Stages and exit criteria

### 1. Field semantics

For each field the adapter reads, record these things:

- the official definition, with a citation (specification, field number, Q&A);
- the one meaning Pythia gives the field;
- its measured behaviour: how many values per identifier, the null and
  placeholder rates, and its vocabulary.

Also list the unread fields that could answer a question we ask.

**Exit:** every field that is read has a cited definition and exactly one
meaning. Relevant unread fields are listed with a reason. Any gap between
measured behaviour and the definition is listed as an odd case.

### 2. A defensive adapter that emits typed claims

- The adapter emits claims keyed by a global identifier (ISIN, LEI, CIK, FIGI,
  ticker@MIC).
- Each claim carries these properties:
  - a meaning from core's fixed vocabulary, for example `notional_currency`
    rather than `currency`;
  - the source field;
  - the as-of date;
  - a record digest.
- It never picks a winner and never reads another source. An empty answer is
  recorded as absence of evidence, not as a negative fact.
- Unexpected input is surfaced, not coerced:
  - unknown codes, malformed identifiers, placeholder dates and missing
    elements are counted on every build;
  - a structural break fails that source's stage visibly and keeps the last
    good build ([ADR 0031](../decisions/0031-connector-execution-and-visible-failures.md),
    [ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).
- Network-free tests use synthetic fixtures that cite the specification. They
  cover each field's parse and each odd case.

The reference builder does not write claims yet. Until it does, an adapter
change carries the meaning in its names and types in the same way.

**Exit:**

- every field in the stage 1 table has a parse and a test;
- no field feeds two meanings;
- every odd case has a counter.

### 3. Drift detection

Each build computes a fingerprint of the source and records it in the manifest.
It covers these checks:

- the set of elements or columns;
- value vocabularies;
- per-field null and placeholder rates;
- the per-identifier value counts from stage 1;
- answer rates per request type;
- record counts per segment.

The build compares the fingerprint with the last good build. Every check has an
alarm threshold:

- a structural break fails the stage;
- a shift past its threshold is reported with examples.

This is how we find out that a provider has changed something before users do.

**Exit:**

- the fingerprint is written on every build;
- every stage 1 assumption has a check;
- a test feeds a synthetic changed input and trips the alarm.

### 4. A full data audit

- **Random sample.** Draw a stratified random sample over the source's natural
  dimensions, for example kind × venue type × region. Freeze it with a seed.
  - Label it field by field against primary sources: the exchange, the
    issuer's filings, GLEIF or the SEC. Never label against another aggregator
    or against the build's own inputs.
  - Report per-field precision with Wilson 95% bounds.
- **Truth set.** A hand-picked truth set is a regression suite, not the quality
  measure. Never edit a truth entry to match a build.
- **Invariants.** They run on every build as smoke alarms. They encode a
  standard or logic, such as a withdrawn ISO 4217 code or one ticker naming two
  securities on one venue. They do not encode name patterns, and they never
  change data.
  - A limit is 0.
  - A ratchet at today's count is allowed only while a named fix is under way.
- **Odd cases.** List every odd case in the source record with:
  - its count;
  - an example;
  - the explanation;
  - its handling: adapter, precedence rule, judgement question or accepted
    limit.

**Exit:**

- the sample is labelled and its precision is published;
- every odd case is explained or marked open;
- no invariant limit accepts a known error without a named fix.

### 5. Judgement cases

Some cases need judgement that no field settles. For example: is this LEI the
issuer, a subsidiary, or unrelated? Each such case becomes a question type
answered by a resolver plugin that acts as a classifier, such as Jev
([ADR 0037](../decisions/0037-identity-backbone.md)). A question type has
these parts:

- **The question.** Its closed-world candidates, the evidence it receives, and
  the relations a verdict may produce.
- **A versioned question set.** See [Writing judgement questions](#writing-judgement-questions).
- **A gold set.** It is stratified and includes hard strata and negatives. It
  is split into dev and test, and the split is frozen before any tuning.
- **A threshold per relation.** It is fitted on dev and checked on test.
  - `model_confirmed` applies only where the band's precision on test has a
    Wilson 95% lower bound of at least 99%. With zero errors, that takes about
    385 assertions.
  - Otherwise the question type is suggest-only: `model_suggested`, and the
    answer goes to Repairs.
- **Core's `decide()`.** Every verdict passes through it, so no verdict
  confirms against identifier evidence, and the depositary-receipt guard always
  holds.
- **A check of final outputs.** During development, run the judge on a build
  and inspect a sample of the values it finally writes, not only the verdict
  scores. What matters is whether the data that reaches the user is right.

Not every hard case is a judgement case:

- comparisons, dates, counts and identifier agreement belong in code;
- a question the model could answer only from memory stays unknown or goes to
  Repairs. Examples are an exchange symbol, or a home market with no evidence.

**Exit:**

- every residual class is assigned to code, to a question type or to Repairs;
- each question type has its question set, gold set, and either a threshold or
  a suggest-only status;
- each has a recorded check of final outputs.

### 6. Sign-off

Sign-off is a reviewed pull request that sets the record's status to `trusted`
and is approved by the project maintainer. The record then states:

- the evidence for each stage;
- the builds and sample that were measured;
- the date.

Every open item is either closed or accepted with a limit and an owner.

After sign-off, the source may do two things:

- auto-confirm within its signed-off question types;
- become a default.

Any of these reopens the affected stage:

- a drift alarm;
- a change to the specification;
- a new field use;
- a new question type.

Trust in the affected fields is suspended until that stage passes again.

## Good and bad adapter code

Good code encodes documented semantics or a standard. It is general and holds
up when new data arrives. For example, RTS 23 field 5 is the "LEI of issuer or
trading venue operator".

- The adapter emits it as `issuer_or_venue_operator_lei`.
- An LEI that ISO 10383 lists as a venue operator's leaves the issuer unknown
  and opens a question.
- No names are compared.

Other good examples are parsing a share class from the ISO 18774 FISN, and
joining rows on a shared composite FIGI.

Bad code takes one of three forms.

- **A hand list standing in for a field nobody reads.**
  - Example: an ordered list of "home" venues keyed by ISIN country put Chubb
    on SIX in CHF.
  - The evidence says otherwise. FIRDS field 8 shows that the issuer requested
    no EEA admission, and the SEC registrant lists on NYSE.
- **A tie-break that hides ambiguity.**
  - Example: preferring the shortest ticker among OpenFIGI rows gave Société
    Générale's Stuttgart line `GLE`. That is also Gladstone Commercial's
    ticker there. A later rule then quietly dropped the ticker from one line.
  - Two claimants are a conflict to show, not a list to sort.
- **A name heuristic used as identity.**
  - Examples: spotting a financing vehicle by a name pattern, or linking an
    issuer through a unique normalised name.
  - Use GLEIF Level 2 relationships instead, or ask a judgement question and
    keep the answer a suggestion.
  - Names may be judge features and alarm descriptions, never identity.

A rule that encodes a named case rather than a source meaning has no stopping
point. It fixes its own examples and moves the errors somewhere else.

## Where judgement material lives

| Material | Where | Why |
| --- | --- | --- |
| Question sets (Jev prompts), versioned as `<question>@<n>` | Public source, next to the code that asks them. Build-time questions go under `tooling/reference-builder/judge/`; runtime questions go in the resolver plugin's package | Reviewed like code. The version is part of every verdict's input digest |
| Eval harness: scorer, calibrator fit, threshold selection | Public source, beside the question sets. Its tests use synthetic rows | Anyone can reproduce the numbers |
| Gold labels built only from open identifiers whose terms permit reproduction | May be committed, like the truth set | Public evidence |
| Gold labels on licensed provider rows, raw requests and responses, and verdicts | On the device (`.local/`) or in private working records; never committed | Provider terms, the repository rule against committing provider responses and model output, and [ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md) |
| Evaluation summary | The source record | Public evidence for sign-off |

The evaluation summary covers:

- the gold manifest: strata, sizes, seed, split and file hash;
- the labelling protocol;
- the model and question versions;
- the thresholds;
- precision with its bounds;
- the check of final outputs.

## Writing judgement questions

Follow the [prompting guidance](../prompting.md). For Jev in particular:

- **Pin the model version and record it.** Each of these makes a new question
  version that needs a new calibration:
  - a new model version;
  - a change to the wording;
  - a change to how the evidence is rendered.
- **Give every option a positive criterion.** Include `none` and `several`,
  keep candidates closed-world, and pass names and identifiers as data in the
  state.
- **Keep arithmetic, dates, counts and identifier comparison in code.** Send
  only the evidence the question needs, because irrelevant state degrades
  answers.
- **Calibrate per question and per relation.** Never carry a threshold from
  one question type to another, or from one question form to another. Use the
  option probabilities, not the vendor's `confidence` field.
- **Keep the test split untouched.** Do not tune wording on it. If a fix was
  prompted by errors seen on test, draw a fresh test split before quoting its
  numbers.
- **Let mechanical guards win.** The depositary-receipt, share-class and
  identifier-contradiction guards override the model.
- **Use made-up values in examples.**
