# Change validation

Use the cheapest current evidence that can disprove a change:

1. run the smallest focused deterministic check or test;
2. run affected workspace checks and tests;
3. run `just check` for shared code or tooling and `just test` for the ordinary
   pull-request suite; and
4. run `just qualify` only for broad installation, update, or assembled-runtime
   evidence that focused tests cannot prove.

Keep network/registry auditing in `just audit`. Provider calls, credentials,
external writes, host services, destructive actions, and long-lived processes
remain separately approval-gated. Use disposable state, own every resource,
and clean it in `finally` or an equivalent guaranteed path.

Report exact commands, outcomes, and untested gaps. Do not reuse green evidence
after behavior-affecting source changes.

Documentation and instruction-only changes normally need link, scope and
projection checks, not an application build or live model run. For prompt
behavior changes, follow [prompting guidance](../docs/prompting.md); do not treat
matching prompt snapshots as proof of better judgment.
