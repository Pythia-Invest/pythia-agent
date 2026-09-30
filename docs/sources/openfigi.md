# OpenFIGI source record

- **Status:** not started. OpenFIGI was in use before the
  [onboarding standard](../architecture/source-onboarding.md), so the
  `pythia-openfigi` plugin keeps its current role (`grandfathered`,
  [ADR 0042](../decisions/0042-source-onboarding-standard.md)) until its turn.
  This record holds what the plugin reads today and the evidence behind its
  exchange-code table. The stages below are open.
- **Owner:** the `pythia-openfigi` plugin, `runtime/managed/plugins/openfigi/`
  (`mapping.py` parses answers and writes claims; `contract.json` holds the
  exchange-code table). The reference builder reads OpenFIGI through its own
  client, `tooling/reference-builder/reference_builder/openfigi.py`, which is
  not covered here.
- **Scope:** `POST https://api.openfigi.com/v3/mapping`:
  - `ID_ISIN` jobs, one per lookup, for core's `resolve` (a claim batch);
  - `ID_ISIN` and venue-qualified `TICKER` jobs for the agent's `mapping`
    (every candidate, nothing decided).

  Not in scope: the search and filter endpoints and any bulk mapping. OpenFIGI
  introduces subjects on demand only
  ([ADR 0044](../decisions/0044-product-direction.md), note "OpenFIGI
  introduces subjects on demand only").
- **Measured on:**
  - two keyless calls on 2026-09-30: Toyota's ISIN `JP3633400001` (143 lines)
    and the documented `exchCode` values (1,106 codes);
  - the local reference build of 2026-09-28 and its cached OpenFIGI answers:
    91,917 listing FIGIs on venue lines keyed from FIRDS and SEC, and 20,751
    unfiltered ISIN answers.

  Raw responses stayed on the device and are not committed.
- **Changes to other sources' adapters:** none.

Citations:

- [OpenFIGI API documentation](https://www.openfigi.com/api/documentation):
  the mapping request and response fields, and the rate limits;
- [OMG FIGI 1.3](https://www.omg.org/spec/FIGI/1.3/PDF): the FIGI, composite
  and share-class levels; Annex D.2 restricts redistributing ISIN-to-FIGI
  mappings, so the contract declares `hostable: false`;
- [OpenFIGI terms of service](https://www.openfigi.com/docs/terms-of-service)
  and [FAQ](https://www.openfigi.com/about/faq): FIGIs are public domain and
  the metadata is under MIT ([ADR 0039](../decisions/0039-local-first-reference-data-and-rights.md)).

## 1. Field semantics

| Field | Official definition | Pythia meaning | Measured behaviour | Read today |
| --- | --- | --- | --- | --- |
| `figi` | The instrument's FIGI at trading-venue level | The line's `figi` (`self`) and its native reference, scope `figi` | On every line | yes |
| `compositeFIGI` | The country-level composite that groups one market's venue lines | The line's `composite_figi` | A composite's own line has `figi` equal to it. Toyota: JP, GR, US, MM and seven EO composites | yes |
| `shareClassFIGI` | The share class, across countries | The line's `share_class_figi` (`self`) | Null on 6 of Toyota's 143 lines; the line then carries none. 4 of 20,751 ISIN answers span two share classes, for example a stapled security that took over a trust's ISIN | yes |
| The job's ISIN | The identifier OpenFIGI maps to each line | The line's `isin` (`self`) at security scope: the mapping is OpenFIGI's own statement, as GLEIF's ISIN filter is GLEIF's, so it is not an echo | Toyota's answer held only ordinary share lines (all `Common Stock`), none of its ADR | yes |
| `exchCode` | Bloomberg exchange code | `provider_venue`; an operating MIC only through `venue_codes` (below) | Codes name venues, country composites (US, GR, JP) or European composites whose lines use X-prefixed codes (EO) | yes |
| `ticker` | The exchange ticker as Bloomberg writes it | An attribute, never a key or identifier; kept only in core's ticker grammar, since core refuses a batch with a malformed one | MTF lines add a currency (`7203USD`). 9,324 of 1,187,119 cached lines fall outside the grammar, mostly with `/` (`AMD/B`) | yes |
| `name` | Security name | The line's `name` | Upper case | yes |
| `marketSector` | Bloomberg market sector | `asset_class: equity` for `Equity`; nothing otherwise | ETFs and receipts are Equity too | yes |
| `securityType`, `securityType2`, `securityDescription` | Bloomberg security types and description | not read into claims; the agent's `mapping` shows them | | no |

A line is the country composite, and is left out of a claim batch, when other
lines name its FIGI as their composite FIGI and its code maps to no venue. In
the cached answers, AU (the ASX) was both a composite other lines named (1,042
answers) and a venue line, so a mapped code keeps the line. The composite's
FIGI still reaches core as each venue line's composite FIGI.

### Exchange codes

`venue_codes` maps a code to an operating MIC only where the evidence names one
venue:

- in the reference build of 2026-09-28, OpenFIGI's lines with that code sat on
  venue lines that FIRDS or SEC keyed under one operating MIC, in at least 20
  listings with no other reading (for example GD on XDUS 11,088 times, JT on
  XJPX 904, BU on XBUL 450);
- one code per operating MIC: the builder's main code where
  `reference_builder/rules.py` names one, else the code that dominates that
  venue's lines;
- every code is in OpenFIGI's documented `exchCode` values.

Left unmapped, so their lines carry no MIC:

- country composites (US, GR, JP, SW, MM, CN), the European composite EO and
  the X-prefixed codes of its lines, whose venues are not confirmed;
- second books on a mapped venue's operating MIC, such as GT (Xetra), LA
  (Hamburg), GZ (Munich's gettex) and XS (Stuttgart). Mapping them would give
  one security two lines on one MIC, which derive the same price address;
- the US exchange codes (UN, UW, UQ, UR, UA, UP, UF and others). OpenFIGI gives
  a line for every US exchange a security trades on, not only where it lists: a
  Nasdaq Capital Market share also has UN, UA and UP lines. Mapping them would
  show unlisted trading as NYSE or Cboe listings. US listings come from SEC in
  the reference, and OpenFIGI's lines join them by FIGI;
- codes seen on fewer than 20 listings, such as LG (Riga).

Toyota's 143 lines give 132 claims, 11 with an operating MIC: XJPX, XFRA,
XDUS, XSTU, XMUN, XHAM, TGAT, XWBO, XBUL, XLON and OTCM. Nine of those lines
carry the FIGI the reference build of 2026-09-28 already had on that venue.

## 2. Adapter and drift alarms

- [x] Every field has one parse and one claim meaning, keyed by a global
  identifier (the FIGI).
- [x] The adapter picks no winner and reads no other source.
- [x] An empty answer is recorded as absence: "no match" is `empty`, never
  proof that the instrument does not exist.
- [ ] Unexpected input is counted, never coerced. Today a malformed FIGI or
  field type fails the whole answer (`invalid_response`).
- [ ] Fingerprint checks: not defined.
- [x] Network-free tests use synthetic fixtures
  (`runtime/test/python/test_openfigi_connector.py`).

## 3. Data audit

Not started.

## 4. Judgement cases

None: the plugin decides nothing. Core's join decides where a line belongs.

## Sign-off

- [ ] Every stage meets its exit criteria.
- [ ] Every open item is closed, or accepted with a limit and an owner.
- [ ] The reviewer, date and PR are recorded.
