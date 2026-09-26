# Hermes wire-capture goldens

Status: accepted, 2026-09-23.

## Context

Desk parses Hermes's HTTP bodies, `/v1/runs` SSE frames, saved history rows,
fixed notice strings, tool-result shapes and some CLI output. Its tests built
these values by hand, typed against Desk's own types, so a renamed event, field
or string in a new Hermes release left them green while the UI quietly got
worse. The repository already rules that a hand-written fixture cannot be its
own oracle. `AGENTS.md` also forbids committing provider responses and
generated model output, which left open whether output captured from Hermes
itself may be committed.

## Decision

- `tooling/qualification/hermes-wire-capture.py` runs in the pinned Hermes
  virtualenv (`just capture-hermes`). It follows upstream's own API-server
  test harness: it serves the real `APIServerAdapter` routes from an aiohttp
  `TestServer`, replaces `_create_agent` with a scripted agent, and uses a
  disposable `HERMES_HOME` and `SessionDB`. Strings come from the Hermes
  functions that produce them, such as the notice formatters, tool handlers,
  tool-result builder and steer delivery. CLI text comes from the pinned
  `hermes` entry point.
- No model, provider, credential or network is involved. The capture refuses
  every connection that is not loopback, and it fails if Hermes attempts one.
  Approvals run in `manual` mode, because the default `smart` mode first asks
  an auxiliary model.
- The capture replaces run ids, generated ids, temporary paths and wall-clock
  times with stable values. It changes nothing else. The goldens and their
  `provenance.json`, which records the release, commit, script and capture
  date, live in `apps/desk/test/fixtures/hermes/`. Biome skips that directory
  because the files must stay byte-for-byte what the capture wrote.
- Committing these goldens is allowed. They must contain only output that
  Hermes generated from scripted agents: no credentials, no real model output
  and no provider responses. Scripted text that stands in for a model's words
  is synthetic and must be obviously fictional.
- Desk unit tests run the goldens through Desk's real parsers and assert what
  the user would see. Rerun the capture on every Hermes bump and review the
  diff as part of the upgrade. `just check-hermes-capture`, which is the first
  step of `just qualify`, fails when a fresh capture differs from the
  committed goldens.

## Rationale and consequences

A golden produced by the pinned Hermes is an oracle Desk does not control. On
a bump, the golden diff lists exactly what changed on the wire. Any Desk test
that depends on a changed value then fails, instead of the UI getting worse
without anyone noticing. Upstream's own harness keeps the scaffolding small and
matches how Hermes tests itself.

Capturing needs a hydrated pinned runtime (`just dev-init`), so the check runs
in qualification and in the upgrade workflow rather than in every pull
request. Some surfaces cannot be captured without a provider or network: the
model catalog, a logged-in auth status, and real tool results from search
backends. Those stay covered by hand-written fixtures, and the contract's
touchpoint index labels them that way. A known mismatch that a golden exposes
gets a skipped or `todo` test with its owner, so it is not papered over.

Keeping hand-written fixtures only was rejected, because they cannot detect
drift. Recording a live provider session was rejected: it needs credentials
and spend, it commits provider responses and model output, and it is not
reproducible. Running Hermes inside every unit test was rejected because it
is slow, needs Python and the pinned runtime in the ordinary test loop, and
gives no reviewable diff.
