# <Source> source record

Copy this file to `docs/sources/<source>.md` when onboarding starts, and keep it
current. [Source onboarding](../architecture/source-onboarding.md) defines the
stages. Mark each item done, open or not applicable, and give the evidence.

- **Status:** not started / in onboarding (stage N) / trusted (signed off
  YYYY-MM-DD, PR #N) / suspended (reason).
- **Owner:** the adapter module or plugin package.
- **Scope:** the files, endpoints, categories and venues covered.
- **Measured on:** the source files or builds, with their dates.
- **Changes to other sources' adapters:** each change, and why this source
  needed it.

## 1. Field semantics

| Field (spec number, path) | Official definition, citation | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| | | | | |

Relevant unread fields, and announced specification changes:

- …

## 2. Adapter and drift alarms

- [ ] Every field has one parse and one claim meaning, keyed by a global
  identifier.
- [ ] The adapter picks no winner and reads no other source.
- [ ] An empty answer is recorded as absence.
- [ ] Only direct field values are `source_asserted`.
- [ ] Unexpected input is counted, never coerced.
- [ ] A structural break fails the stage and keeps the last good build.
- [ ] Network-free tests use synthetic fixtures that cite the specification.

| Fingerprint check | Baseline | Alarm |
| --- | --- | --- |
| | | |

## 3. Data audit

Random sample:

- strata;
- size;
- seed;
- the primary sources it was labelled against;
- the labelling date.

| Field | Precision (Wilson 95%) | n |
| --- | --- | --- |
| | | |

Invariants:

- the name, limit and reason of each;
- the named fix behind any ratchet.

### Odd cases

| Case | Count (unit) | Example | Explanation | Handling | Status |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## 4. Judgement cases

| Question type | Why code can't decide it | Question set | Development check | Gold set and threshold, or suggest-only |
| --- | --- | --- | --- | --- |
| | | | | |

Classes assigned to code or to Repairs instead:

- …

## Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] Every open item is closed, or accepted with a limit and an owner.
- [ ] The reviewer, date and PR are recorded.
