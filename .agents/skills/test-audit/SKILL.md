---
name: test-audit
description: Gate new or changed tests and audit existing ones for low value. Use when writing, changing or reviewing tests, when the user asks to clean up, prune or audit tests, or when a suite is slow, flaky or duplicative.
---

# Test audit

One value bar, three modes. The **authoring gate** applies whenever you add or
change a test. An **audit** is a read-only sweep that reports candidates with
evidence. A **campaign** prunes one whole area's tests; read
[CAMPAIGN.md](./CAMPAIGN.md) first. Adapted from OpenClaw's test-audit skill.
Read [test allocation](../../testing.md) and the nearest nested `AGENTS.md`
first.

The core rule: a test that breaks under a behavior-preserving refactor asserts
implementation, not behavior.

## Authoring gate

Before adding a test, answer all four. A missing answer means don't add it yet.

1. What observable behavior, invariant or independent contract does it protect?
2. What credible regression makes it fail?
3. Why doesn't existing coverage catch that already? Each contract has one
   primary owner at the strongest boundary. Another layer needs its own
   distinct risk, such as a transport or lifecycle failure the owner cannot
   reach. Extend a table-driven case or shared fixture instead of adding a
   near-duplicate.
4. Does it need a production seam (an export, flag, parameter or wrapper) that
   no production caller uses? If so, test at the real boundary instead.

Then check it against the junk patterns below. A match fails the gate unless
the retention bar names the contract the test independently guards.

A bug-fix regression test must fail on the unfixed code for the intended
reason and pass after the fix; show both. One regression at the owning
boundary covers the bug; don't replay it at every layer it crosses. A test
that rejects bad input must fail if the guard it names is removed. Prove that
once by removing the guard and watching the test go red, then restore the
source byte for byte.

## Junk patterns

- assertion-free probes, and checks that cannot fail (for example `toContain`
  on a class string that always holds the word);
- self-comparisons, or expected values produced by the code under test;
- copied fixtures, inventories, manifests, export lists or workflow text;
- exact source, import, copy, class-name or CSS assertions;
- private call-shape tests that duplicate a real boundary's test;
- the same contract asserted twice, at two layers or in two files;
- tests of another library's behavior (React escaping, Base UI output, git,
  a Markdown or PDF parser);
- tests that exist only to keep a test-only export, parameter or wrapper
  alive, and production code whose only callers are tests;
- mocks that implement the asserted behavior;
- fixtures that supply the ordering, receipt or state the owner should
  produce, or a state the real code can never reach;
- negative checks that pass for an unrelated reason (a missing file, a
  different guard, an empty header);
- names that promise more than the assertions check;
- hand-written Hermes shapes where an ADR 0020 golden exists.

## Retention bar

Keep a test that independently enforces a public API, widget SDK, protocol,
Hermes touchpoint, config, migration, storage, credential, security, platform,
default, package, release or architecture contract. Also keep:
- call ordering, when the order is observable behavior;
- regressions with a credible failure mode;
- source inspection, when it is the cheapest independent guard and survives
  an identifier-only refactor;
- a retained test that fails on `main`: treat it as a possible product bug,
  reproduce it, and fix the owner instead of deleting the test.

Being static or slow is not a reason to delete a test. A test that looks like
implementation may still be the only proof of a contract; show otherwise
before removing it.

## Audit

Discovery is read-only. Report evidence before editing. Before judging a
candidate, read:
- the whole test and its production owner, with entry points, callers and
  sibling implementations;
- overlapping tests, including `apps/desk/e2e`;
- which CI job runs it (`.agents/change-validation.md`, ADR 0046);
- `git log` for why it exists.

For each candidate, record:
- the test name and `file:line`;
- what failure it can actually detect;
- non-test callers of any seam it keeps alive;
- the stronger proof that remains, or why no contract exists;
- the history;
- the production code its deletion unlocks;
- the risk, and the command that validates the change.

A missing field means the candidate isn't ready. Prefer a few high-confidence
candidates to a long speculative list.

## Edit shape and validation

Work in one owner-boundary batch per commit. Delete obsolete test-only seams
and dead production paths instead of keeping aliases. Move retained regressions
to their canonical owners. Prefer net-negative lines, and never convert
uncertain candidates into deletions to raise a count.

Serialize heavy commands with `/usr/bin/lockf -k /tmp/pythia-heavy.lock`, and
never edit files while a test runner is running in that checkout. Run the
owning suites, the workspace's `check` script, `just check-static` and
`git diff --check`. Report test and production line changes separately
(`git diff --numstat`), along with each mutation you ran, retained false
positives and follow-ups.
