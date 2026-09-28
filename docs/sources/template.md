# <Source> source record

Copy this file to `docs/sources/<source>.md` when onboarding starts, and keep it
current. The stages and their exit criteria are defined in
[source onboarding](../architecture/source-onboarding.md). Mark each item as
done, open or not applicable, and give the evidence behind it.

- **Status:** one of:
  - not started;
  - in onboarding (stage N);
  - trusted (signed off YYYY-MM-DD in PR #N);
  - suspended (reason).
- **Owner:** the adapter module(s) or plugin package.
- **Scope:** the files, endpoints, categories and venues in scope.
- **Measured on:** the source files or builds and their dates.

## 1. Field semantics

| Field (spec number, path) | Official definition, with citation | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| | | | | |

Relevant fields not read, and why:

- …

## 2. Adapter

- [ ] Every field in the table has one parse and one claim meaning.
- [ ] Claims are keyed by a global identifier.
- [ ] The adapter picks no winner, reads no other source, and records an empty
  answer as absence.
- [ ] Unknown codes, malformed identifiers, placeholders and missing elements
  are counted.
- [ ] A structural break fails the stage visibly and keeps the last good build.
- [ ] Network-free tests use synthetic fixtures that cite the specification.

## 3. Drift fingerprint

| Check | Baseline | Alarm |
| --- | --- | --- |
| | | |

- [ ] The fingerprint is written to the manifest on every build.
- [ ] A test with a changed synthetic input trips the alarm.

## 4. Data audit

Random sample:

- strata;
- size;
- seed;
- the primary sources it was labelled against;
- labelling date.

| Field | Precision (Wilson 95%) | n |
| --- | --- | --- |
| | | |

Invariants: the name, limit and reason for each, and the named fix for any
ratchet.

### Odd cases

| Case | Count (build) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## 5. Judgement cases

| Question type | Why code can't decide it | Question set | Gold set (size, strata, split, hash) | Threshold or suggest-only | Final-output check |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Classes assigned to code or to Repairs instead:

- …

## 6. Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] Every open item is closed, or accepted with a limit and an owner.
- [ ] Reviewer, date and PR are recorded.

Open items accepted at sign-off:

- …
