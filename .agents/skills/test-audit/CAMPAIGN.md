# Test-pruning campaign

A campaign prunes one area's whole test surface: a workspace, a plugin, or the
root lifecycle tests. The value bar, retention bar, candidate evidence and
validation in [SKILL.md](./SKILL.md) apply throughout. Each step ends on its
completion criterion; don't start the next early.

Set an ambitious, measurable goal, for example "remove the least useful 20% of
test lines while line coverage stays within two points". Without one, the work
stops too early. Still, never delete without evidence: the September 2026
campaign found about 11%, because most of the rest guarded real contracts.

## 1. Baseline

At a pinned `main` commit, record test and support line counts, every test
file's pass or fail state and duration, and line coverage for the gate's
vitest projects (`vitest run --coverage.enabled --coverage.provider=v8`,
measured, never a target). Keep baseline failures on their own list; each is a
possible product bug.

## 2. Lanes

Split the surface along production owners, not file prefixes. For Desk:
server and routes, chat and work, workspace, and the browser suite. Include
the area's browser specs and qualification tests. Every test file belongs to
exactly one lane.

## 3. Read-only ledger per lane

One read-only agent per lane reads every declaration in full and marks it:

- `R` retain: name the contract and the bug it catches;
- `F` fix: keep the contract, repair the assertion;
- `C` consolidate: name the keeper that absorbs it;
- `D` delete: name the remaining proof, or why no contract exists.

Judge a test by its assertions, not its name.

## 4. Layer plan

Starting from the ledger, look for redundant layers, such as a suite that
replays what a stronger suite proves through a mock. Name the keeper for each
contract, and prefer the real boundary with fake I/O over a mocked
collaborator. List the test-only production seams each deletion unlocks.

## 5. Cutover

Give each lane its own worktree and branch, then merge them. Apply marks
batch by batch, remove the seams the deletions unlock, and register moved
suites in their CI job. Put durable ownership lessons in the nearest
`AGENTS.md`, drawn from mistakes the campaign actually found.

## 6. Preservation review

Independent reviewers compare deleted coverage against the keepers, one
reviewer per boundary group. They look for contracts that lost their only
proof and new assertions that cannot fail. For each restored or repaired
contract, make one deliberate mutation of the production owner and confirm
the keeper goes red. Then restore the source byte for byte.

## 7. Product defects

A baseline failure that survives into a keeper is a bug report. Fix it at its
owner in a separate commit, with a control run that shows the old failure.

## 8. Hand off

Report:
- baseline and final line counts, with production counted separately;
- coverage before and after;
- lanes and keepers;
- rejected ledger marks;
- mutations run;
- defects fixed;
- follow-ups.
