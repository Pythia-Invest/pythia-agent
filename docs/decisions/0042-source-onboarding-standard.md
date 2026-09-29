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
- **One audit per source, never batched.** Onboarding means the audit, the
  judgement work and sign-off. Several sources may be in onboarding at once
  (amended 2026-09-28, below), each with its own pull request, record, audit and
  sign-off. A source in onboarding may change another source's adapter when it
  needs that source's evidence. It records the change in both records and does
  not widen what the other source confirms.
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

- FIRDS was onboarded first.
- **The pre-standard sources keep their current role** while they are onboarded:
  - the builder's FIRDS, FITRS, GLEIF, SEC, OpenFIGI and ISO 10383;
  - N-CEN, which is in review;
  - the bundled plugins: coingecko, coinmarketcap, eodhd, gleif, openfigi, sec,
    xbrl-filings and yahoo-discovery;
  - the connector runners under `runtime/managed/runner/` (EODHD, CoinGecko
    and Yahoo).
- Coverage grows more slowly.
- The builder's planned move to typed claims, reconciliation and a build-time
  judge step implements stages 2 and 4.
- **The code gate is built.** Each plugin's `contract.json` declares its
  `signoff`: `signed_off` with its record, `grandfathered`, or `unsigned`. The
  bundled plugins above are `grandfathered`, each pointing at its pending
  record in `docs/sources/`. The builder's reference sources are not plugins;
  their record and its review remain their gate. A plugin cannot vouch for
  itself: core honours `signed_off` or `grandfathered` only from the plugins
  Pythia bundles and treats every other plugin as `unsigned`, whatever its
  contract says (since the 2026-09-30 amendment, only where a grant on the
  plugin's files confirms it, whatever its name). For an `unsigned` source:
  - a fresh profile never enables it, even if its payload lists it as enabled
    by default;
  - core's order never ranks it ahead of an audited source, so where one
    source serves (a price, a profile, a filing authority) it serves only when
    the investor names it in `source_order` or nothing audited can serve;
    once enabled, it joins a merged list or side-by-side values like any
    other source (amendment below);
  - a resolve answer that would bind becomes an `unaudited` residual, with the
    matching evidence, for the investor to review; the agent's answer to it
    only suggests;
  - pages, alternatives, filings results and market-data reads mark it
    unaudited, which the Desk shows as "not yet audited".

  The investor may still enable it; turning it on is the opt-in. A source that
  ships opt-in and is display-only (it never confirms or creates identity), as
  Hyperliquid's live view does ([ADR 0043](0043-live-market-view.md)), may ship
  before sign-off as `unsigned`.

## Rejected alternatives

- **Auditing several sources together.** One build that took in five sources
  at once, with one shared audit, is how the misread fields and the per-case
  rules accumulated. Separate audits running at the same time are allowed
  (amendment below); a combined one is not.
- **Measuring quality on the hand-picked truth set.** It rewards fixing the
  names it contains.
- **Fixing odd cases with more rules.** A rule written for a named case has no
  stopping point.
- **Auto-confirming judge verdicts before calibration.** Jev scored 7%
  precision on EU depositary receipts in the gold-set evaluation.
- **Requiring a gold set for suggest-only questions.** Most of the cost for
  little safety: a suggestion is reviewed anyway.

## Amendment (2026-09-28): several sources in onboarding at once

**Context.** The original ruling allowed one source in onboarding at a time.
FIRDS then held the slot while the SEC, filings.xbrl.org, Yahoo and the national
regulators waited behind it, although their audits share no work with FIRDS.

**Ruling.** The founder's ruling, 2026-09-28 (decision C5): "just continue and
parallelize what we can. But use a healthy amount of resources."

- Several sources may be in onboarding at the same time.
- Each has its own pull request, source record, audit and sign-off. Sources are
  never batched into one audit, one record or one sign-off.
- A source in onboarding may still change another source's adapter only when it
  needs that source's evidence, recorded in both records.
- Parallel work stays proportionate: audits are scripted over cached data, and
  labelling is limited to the random sample.

**Rationale.** The errors this standard answers came from one shared audit of
five sources, not from audits running side by side. A separate record, sample
and sign-off per source keep each source's odd cases visible.

**Consequences.** `docs/architecture/source-onboarding.md` says the same. A
source's record names the other sources whose open work it depends on (the
SEC's CIK links depend on FIRDS field 5), and its sign-off does not wait for
theirs unless it confirms through their evidence.

## Amendment (2026-09-29): trust levels

[ADR 0044](0044-product-direction.md) sets three plugin trust levels: display,
suggest identity and confirm identity. Only confirming identity requires this
standard's full audit and sign-off. A display-only plugin, including a user's
own licensed vendor, needs declared coverage and terms only. As direction,
display will also include introducing subjects, which confers no authority
over them. Today no plugin creates subjects; the rule that a source creates no
subjects before sign-off changes for introduced subjects when roadmap stage 0
lands, while establishing facts about them still depends on trust level.

The code gate maps onto them without a new field: `unsigned` is display, and
`signed_off` or `grandfathered` is confirm.

- **Display.** An enabled `unsigned` plugin serves and merges its data as
  normal: under a combining concept (news, side-by-side values) it is one of
  the sources read, without being named in `source_order`. Its data is
  labelled with its source and "not yet audited". It stays off in fresh
  profiles, and where one source serves it comes after every audited source:
  it serves only if the investor names it or nothing audited can serve.
  Enabling it is the opt-in; naming it is what puts it first.
- **Confirm.** Unchanged: only a signed-off or grandfathered plugin creates or
  changes a binding. A display plugin's resolve answer that would bind stays
  an `unaudited` residual for the investor. (The amendment "binding by trust
  level" adds device subjects and one display exception.)
- **Suggest** (a plugin whose matches the investor confirms in one click) is
  not represented yet. It arrives with the first plugin that needs it, such as
  a user's own vendor addressed by `resolve`.

As direction, the statement above that the builder's reference sources are
not plugins is reversed: reference sources contribute through the same
contract as any plugin, and trust attaches to a signed or hashed release
rather than to a plugin's name. Reviewed answers over open data may ship as a
Pythia-maintained answer list (ADR 0044, amendment A7). Gold labels on licensed
data and raw model exchanges stay on the device. Further source audits are paused until a
strategy's universe or a second user needs them.

## Amendment (2026-09-29): builder rules name kinds of evidence

**Context.** [ADR 0044](0044-product-direction.md) A2 requires rules that name
kinds of evidence and trust levels, never sources, and that are published,
versioned and overridable locally. The reference builder's rules tested
source names in ten places: only FIRDS securities had their primary decided
and questions asked, OpenFIGI's lines counted as evidence outside the EEA,
SEC securities took their first US exchange line as primary, and a stated
receipt underlying was checked only when FIRDS stated it. The rules version
had stayed at 1 through many rule changes.

**Ruling.**

- Every row the builder assembles carries the kind of evidence it rests on:
  an admission register (FIRDS), a listing directory (OpenFIGI's
  home-exchange lines), a registrant filing (the SEC ticker and fund files)
  and, on a receipt edge, a stated underlying. Rules test the kind. A
  source's name is provenance only, so a second source of the same kind
  decides alike.
- An onboarded source's adapter sets the kind on each row it creates. A new
  kind is a rule change, reviewed like one.
- `just check` fails when a builder module other than its adapters and
  audits, or a core identity module, compares a field named source, plugin or
  provider with a literal. A test renames every source and expects the same
  decisions. Core's list of bundled plugins (`BUNDLED`) is still trust by
  name; it stays until trust follows a hashed release, later in roadmap
  stage 0.
- The builder version is the rules version. It is recorded on every
  assertion, in `package.json` and in the release table. Every rule change
  bumps it with a line in the builder README's "Rules versions".
- "Overridable locally" means open rules the user can change and rebuild, and
  the user's own verdicts on the device. There is no rule-override
  configuration.

**Rationale.** A rule keyed on a source's name gives that source authority by
name, which A2 and A4 remove. The same rule keyed on the kind of evidence
keeps its meaning when a source is replaced or joined by another of its kind.

**Consequences.** On the 2026-09-28 build the change of names alone decides
nothing differently. Where no rule decides, the builder now leaves the
disagreement open: identifier links that conflict become `issuer_identity`
questions instead of a winner by CIK order. Trust levels still come from the
builder's `snapshot` authority until trust follows a hashed release.

**Rejected alternatives.**

- A per-source trust table inside the builder: trust by name again.
- A second rules-version constant beside the builder version: two numbers to
  keep in step.

## Amendment (2026-09-30): trust follows a hashed release

**Context.** [ADR 0044](0044-product-direction.md) A4 attaches trust to a
signed or hashed release, not to a plugin's name. The code gate above honoured
`signed_off` or `grandfathered` only from a list of the plugin names Pythia
bundles (`BUNDLED`). Any plugin installed under one of those names was trusted,
and a byte-identical copy under another name was not. Nothing is published
yet, so no signature exists to check.

**Ruling.** Trust is looked up by a digest of the plugin's files.

- **The digest rule, `pythia-plugin-digest@1`.** SHA-256 over the sorted lines
  `<posix relpath>\t<sha256 of the file>\n`, one per regular file in the plugin
  directory. `.git/` (a git install's clone), `__pycache__/`, `*.pyc` and the
  lifecycle's copy receipt (`.pythia-managed-copy.json`) are left out, so the
  digest does not depend on the machine. A symlink anywhere in the
  directory gives no digest, which means display. Core computes it from the
  installed files, never from the receipt, and caches it on each file's size,
  modification time and inode.
- **Pythia's release grants.** Core's `identity/trust.py` writes
  `identity/trust.json` into the checkout when the payload is assembled, before
  the plugins are copied, so core's copy and its receipt carry it. The
  lifecycle runs it with Hermes's Python in `bootstrapRuntime` (install, update
  and development), in the explicit workspace transition and in the qualification
  assembly. A shipped contract whose `signoff` is `signed_off` or
  `grandfathered` is granted confirm at the digest of exactly its payload files;
  an `unsigned` one is left out. The file is generated, never committed.
- **The user's local grants.** `trust.json` in the Pythia config folder,
  beside `settings.json`, has the same shape and wins in both directions: the
  user may grant a community plugin's digest confirm, or demote a Pythia one to
  display. A user's confirm grant is their own sign-off (ADR 0044 A2, local
  override): it confirms whatever the contract declares, `unsigned` included.
  A malformed file is ignored with one warning, and the release grants still
  apply. `python -P trust.py grant <plugin dir> <display|confirm>` and
  `status` manage it; there is no Desk page.
- **The reference package.** Installing a package records the user's grant on
  `sha256:<its database's sha256>`: confirm, or display with `--display`.
  Reinstalling the same package keeps the choice already recorded, and the
  installer refuses to install where it cannot record the choice (no config
  folder). Core looks
  the package's level up by that digest like any contributor's, and
  `reference-status` shows it. A package installed before grants existed is
  granted confirm once, on core's first use of the store, and the grant is
  logged.
- **Levels.** Display and confirm only. A grants file with any other level is
  malformed.
- **Core.** `installed()` computes each plugin's level from its digest.
  `vouched(manifest, level)` treats the contract as `unsigned` below confirm;
  at confirm the grant is the sign-off. The contract's `signoff` is a
  declaration and the release generator's input; core never honours it alone.
- **Mismatch.** A plugin whose files match no grant, while a grant names it,
  is display, and core logs one warning naming the plugin and its digest. An
  edited Pythia plugin, or a stale release file, shows up this way.

**Rationale.** A digest binds trust to the content that was reviewed: a
renamed copy keeps it, and a different plugin under a trusted name does not
get it. Generating the release grants at assembly keeps them out of every
parallel change to a plugin, and one stdlib function computes the digest both
when the grants are written and at runtime, so the two cannot disagree. The
grants live in the config folder because trust is the user's standing choice,
like `source_order` in `settings.json`, and they survive a store that is set
aside or moved.

**Consequences.**

- Any edit to a Pythia plugin changes its digest. The next preparation
  regenerates the grants; until then the edited plugin is display and core
  says so.
- During a staged workspace transition only core is copied, with grants for
  the current checkout, so a Pythia plugin that changed since the last
  preparation is display until preparation runs. This fails safe.
- A plugin whose trust drops keeps the bindings it already made. Nothing is
  re-keyed or deleted; its sections carry the "not yet audited" label, and a
  new answer that would bind waits for review.
- Evidence counts at its contributor's level: a package's rows at the level of
  its grant, a plugin's claims at its plugin's. Only confirm-level evidence
  proves or blocks, and the builder's `snapshot` authority no longer outranks
  anything ([ADR 0037](0037-identity-backbone.md), amendment of 2026-09-30).
- A 2026-09-30 read-only look at 19 development profiles (196 plugin
  directories) found no file Hermes had written into a plugin directory other
  than `__pycache__/*.pyc`. Fifteen files in two profiles had been edited by
  hand after copying; those plugins now show as display.
- Trust still bounds data, not code: a digest stops name squatting, not
  malicious in-process code.

**Rejected alternatives.**

- Committing `trust.json`: every plugin edit would conflict across parallel
  changes, and a stale file would silently demote plugins.
- A Node digest at assembly beside a Python one at runtime: two
  implementations that could drift and demote every plugin.
- Trusting the copy receipt's hashes: the receipt is the lifecycle's ownership
  record, written beside the files it describes.
- Grants in `<data>/store`: the store holds data, and a user's choice about
  sources belongs with their settings.
- Signatures: nothing is published yet (ADR 0039).

## Amendment (2026-09-30): binding by trust level

**Context.** A binding could only point at a reference subject: the user's
answer was refused for any other target, and only a confirm-level plugin bound.
The identity store now holds device subjects that plugins introduce
([ADR 0037](0037-identity-backbone.md), amendment "device subjects"), and
[ADR 0044](0044-product-direction.md) A4 lets a display plugin introduce
subjects without confirming facts about shared ones.

**Ruling.**

- **Only confirm level binds** a plugin's record to a subject, a reference
  subject or a device subject alike. A display plugin's records whose
  identifiers agree are shown as labelled evidence. Its answer that would bind
  stays an `unaudited` residual, raised only when its subject becomes relevant
  (a resolve for an opened page), for the user to confirm or dismiss.
- **The one display exception:** a plugin's own record binds the device
  subject it introduced (rule `introduced@1`, `device.bind_introduced`), and
  its resolve answer may bind that subject. A subject introduced by another
  plugin, or held by the reference, is shared.
- **The user's answer** may choose a reference or a device subject.

**Rationale.** A subject that exists only through one plugin's records has no
address without that plugin's own binding, and binding it establishes no fact
another source describes. Binding a shared subject does, which needs confirm.

**Consequences.**

- Introducing a subject still confers no authority over facts about it: the
  introducer's identifiers count at its own level, display included.
- Core's ingest of plugin records (roadmap stage 0) writes the `introduced@1`
  binding when a record introduces a subject.

**Rejected alternatives.**

- **Binding at any level:** a display plugin could attach its record to a
  shared instrument without review.
- **No display binding at all:** a display plugin's own pools or tokens would
  have no address and no page data.
