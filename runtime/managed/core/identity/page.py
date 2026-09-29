"""Instrument page composition (ADR 0038, ADR 0040): the subject, its listings and one plugin per section.

`subject_view` is local only: it reads the reference file, the identity store and
the installed plugins' contracts, and never calls a plugin. A plugin whose
contract lets core build its native reference from open identifiers (a MIC
suffix table, an identifier-named native scope, the curated canonical-asset table)
is addressed at once; that derived reference is an address, never identifier
evidence. Only when core cannot derive the address is the section `resolving`:
the Desk then asks for that plugin's resolve (`identity-resolve`), which
`apply_resolve` decides with the one authority rule.

A `market` subject (a perp) comes from core's curated table (`markets.py`); its
page needs no reference file.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Any, Callable, Mapping

from .claims import ClaimBatch, RecordClaim
from .concepts import NOTICE, REGISTRY, Combine, Concept, core_section, ranked, select
from .manifest import ConceptEntry, Manifest
from .markets import MARKETS_RULE
from .model import Binding, ProviderRef
from .resolution import QueueItem, Verdict, VerdictOutcome, decide
from .schemes import CANONICAL_ASSETS_RULE, INSTRUMENT_KINDS, Kind, Level, provisional_id
from .subject import load_subject, related  # noqa: F401  (re-exported: page composition reads subjects)
from .vocabulary import KIND_OF_RECORD, AssetClass, InstrumentKind, VerdictRelation


class Section(StrEnum):
    """Instrument page sections. Each is served by one concept operation (ADR 0040); the Desk renders sections."""

    QUOTE = "quote"
    CHART = "chart"
    PROFILE = "profile"
    FINANCIALS = "financials"
    NEWS = "news"
    FILINGS = "filings"
    LIVE = "live"  # a `live_market` snapshot stream (ADR 0040), subscribed only while the page shows it


# The concept operations that can fill each section, preferred first.
SERVES = {Section.QUOTE: (Concept.MARKET_DATA, ("quote",)), Section.CHART: (Concept.MARKET_DATA, ("daily", "intraday")),
          Section.PROFILE: (Concept.PROFILE, ("fields",)), Section.FILINGS: (Concept.FILINGS, ("list",)),
          Section.FINANCIALS: (Concept.FUNDAMENTALS, ("statements",)), Section.NEWS: (Concept.NEWS, ("list",)),
          Section.LIVE: (Concept.MARKET_DATA, ("live",))}
SECTIONS = (Section.QUOTE, Section.CHART, Section.LIVE, Section.PROFILE, Section.FILINGS)
LABELS = {"yahoo": "Yahoo Finance", "eodhd": "EODHD", "coinmarketcap": "CoinMarketCap", "coingecko": "CoinGecko",
          "gleif": "GLEIF", "xbrl-filings": "filings.xbrl.org", "sec": "SEC EDGAR", "openfigi": "OpenFIGI",
          "hyperliquid": "Hyperliquid", "nsm": "UK FCA NSM"}
SAME = {Level.LISTING: VerdictRelation.SAME_LISTING, Level.COMPOSITE: VerdictRelation.SAME_COMPOSITE,
        Level.SECURITY: VerdictRelation.SAME_SECURITY, Level.ISSUER: VerdictRelation.SAME_ISSUER}
RESOLVE_RULE = "resolve_answer@1"  # a resolve answer to open identifiers binds unless identifier evidence contradicts it
# Read checks (ADR 0037): the stated attributes whose difference from the reference refuses the source. Empty while
# no reference field they compare against is signed off; add "venue" or "currency" once its field is.
ENFORCED: frozenset[str] = frozenset()


@dataclass(frozen=True)
class PluginInfo:
    """One installed plugin as core sees it, from its contract and native Hermes state."""

    key: str                                   # native plugin id: the `plugin` of Desk requests
    manifest: Manifest
    enabled: bool = True
    missing: tuple[Mapping[str, str], ...] = ()  # required configuration not configured
    operations: Mapping[str, str] = field(default_factory=dict)  # plugin operation -> the native tool declaring it

    @property
    def label(self) -> str:
        return LABELS.get(self.manifest.provider, self.manifest.provider)


# Other names investors and agents use for a provider, beside its plugin id, provider name and label.
ALIASES = {"sec": ("edgar", "sec edgar", "sec-edgar"), "xbrl-filings": ("esef", "xbrl", "filings.xbrl.org", "uksef"),
           "yahoo": ("yahoo finance",), "coinmarketcap": ("cmc",), "gleif": ("lei",),
           "eodhd": ("eod",)}
CORE_PLUGIN = "pythia"  # core's own operations (the combined filings read)
ABSENT = frozenset({"not_covering", "not_addressable"})  # a section only these could serve is not shown
# Why a source's answer waits in the resolution queue instead of binding, in the investor's words.
QUEUED = {"unaudited": "the source is not yet audited, so its match waits for sign-off",
          "ambiguous": "several of its records match", "no_key": "its record carries no identifier to check"}


def named(name: str | None, plugins: list[PluginInfo]) -> str | None:
    """The plugin key a caller's source name means: plugin id, provider, label or a common alias; case-insensitive."""
    wanted = (name or "").strip().lower()
    for info in plugins:
        provider = info.manifest.provider
        if wanted and wanted in {info.key.lower(), info.manifest.plugin.lower(), provider, info.label.lower(),
                                 *ALIASES.get(provider, ())}:
            return info.key
    return None


def served_by(manifest: Manifest, section: Section) -> tuple[ConceptEntry, str, str] | None:
    """The plugin's concept entry for a section, the concept operation and the plugin operation serving it."""
    concept, operations = SERVES[section]
    entry = manifest.concepts.get(concept)
    name = entry and next((name for name in operations if name in entry.operations), None)
    return (entry, name, entry.operations[name]) if name else None


def serving(manifest: Manifest, section: Section) -> tuple[ConceptEntry, str] | None:
    """The plugin's concept entry for a section and the plugin operation that serves it, or None."""
    found = served_by(manifest, section)
    return (found[0], found[2]) if found else None


def ordered(plugins: list[PluginInfo], section: Section, order: tuple[str, ...] = ()) -> list[PluginInfo]:
    """The investor's order, then core's default order for the section's concept (free before paid), then key;
    a source not yet signed off follows every audited one unless the investor names it."""
    entries = [{"plugin": info.key, "provider": info.manifest.provider, "unaudited": info.manifest.unaudited,
                "info": info} for info in plugins]
    return [entry["info"] for entry in ranked(entries, order, REGISTRY[SERVES[section][0]].default_order)]


# ---- addressing -------------------------------------------------------------------------------------------------

def derive(info: PluginInfo, level: Level | Kind, subject: dict, coins: Callable[[str, str], str | None]) -> tuple[ProviderRef, str] | None:
    """A native reference core builds without a call, with the rule that built it, or None."""
    manifest, values, listing = info.manifest, subject["values"], subject["listing"]
    if level not in INSTRUMENT_KINDS:  # a market: the curated table names each serving plugin's reference
        ref = subject.get("refs", {}).get(manifest.provider)
        served = ref and any(scope.level is level and scope.native_scope == ref.native_scope for scope in manifest.native)
        return (ref, MARKETS_RULE) if served else None
    for scope in manifest.native:
        if scope.level is not level or (scope.asset_classes and subject["asset_class"] not in scope.asset_classes):
            continue
        if level is Level.SECURITY and subject["asset_class"] == "crypto":
            security = subject["ids"].get(Level.SECURITY) or ""
            native = security.startswith("security:caip19:") and coins(  # by the asset's canonical deployment
                manifest.provider, security.removeprefix("security:caip19:"))
            if native:
                return ProviderRef(manifest.provider, native, scope.native_scope), CANONICAL_ASSETS_RULE
        accepted = manifest.schemes.get(level, ())
        if scope.native_scope in accepted and values.get(scope.native_scope):
            return ProviderRef(manifest.provider, values[scope.native_scope], scope.native_scope), f"{scope.native_scope}_ref@1"
        if level is Level.LISTING and listing is not None and listing["ticker"] and listing["mic"]:
            suffix = manifest.mic_table.get(listing["operating_mic"] or listing["mic"])
            if suffix is not None:
                # A provider symbol has no space: the venue's class separator (`VOLV B`) becomes `-` (`VOLV-B.ST`).
                symbol = listing["ticker"].replace(" ", "-") + suffix
                return ProviderRef(manifest.provider, symbol, scope.native_scope), "mic_table@2"
    return None


def priced_venues(plugins: list[PluginInfo]) -> dict[str, frozenset[AssetClass]]:
    """Operating MICs where a usable plugin addresses a quote from the listing's ticker (its MIC table), with the
    asset classes its listing scope covers (empty: any), the same test `derive` applies.

    Search prefers such a line among an instrument's non-home, non-primary lines, so the page it opens can
    show a price."""
    venues: dict[str, frozenset[AssetClass]] = {}
    for info in plugins:
        served = serving(info.manifest, Section.QUOTE)
        if not (info.enabled and not info.missing and served is not None and served[0].via is Level.LISTING):
            continue
        for scope in info.manifest.native:
            if scope.level is Level.LISTING:
                for mic in info.manifest.mic_table:
                    known = venues.get(mic)
                    wanted = frozenset(scope.asset_classes)
                    venues[mic] = frozenset() if known == frozenset() or not wanted else (known or frozenset()) | wanted
    return venues


def resolve_input(info: PluginInfo, subject: dict) -> dict[str, str]:
    """The subject's identifiers in the schemes the plugin's resolve accepts."""
    if info.manifest.resolve is None:
        return {}
    values, listing = dict(subject["values"]), subject["listing"]
    if listing is not None and listing["ticker"] and (listing["operating_mic"] or listing["mic"]):
        values.setdefault("ticker_mic", f"{listing['ticker']}@{listing['operating_mic'] or listing['mic']}")
    return {scheme: values[scheme] for scheme in info.manifest.resolve.input_schemes if values.get(scheme)}


def _addressable(info: PluginInfo, level: Level | Kind, subject: dict) -> bool:
    return any(scope.level is level and (not scope.asset_classes or subject["asset_class"] in scope.asset_classes)
               for scope in info.manifest.native)


def evaluate(info: PluginInfo, section: Section, subject: dict, *, stored: Callable[[str, str], sqlite3.Row | None],
             coins: Callable[[str, str], str | None], queue: list[dict],
             misses: Mapping[tuple[str, str], str] = {}, checked: Callable[[str, ProviderRef], Mapping | None] = lambda *_: None,
             serves: Callable[[ProviderRef, str], None] = lambda *_: None) -> dict | None:
    """One plugin's answer for one section, or None when its contract does not declare the section's concept.

    A declaring plugin that cannot serve this subject answers with the reason as its status: `not_covering`
    (its coverage excludes the asset class or market), `not_addressable`, `disabled`, `needs_configuration`,
    `conflict` or `unresolved`."""
    served = served_by(info.manifest, section)
    if served is None:
        return None
    entry, concept_operation, operation = served
    concept = SERVES[section][0]
    answer = {"section": str(section), "via": str(entry.via), "plugin": info.key, "provider": info.manifest.provider,
              "label": info.label,
              "concept": str(concept), "operation": concept_operation, "status": "ready", "binding": None,
              "binding_status": None, "verified_at": None, "unverified": None, "request": None, "alternatives": [],
              "reason": None, "authorities": [str(item) for item in entry.authorities],
              **({"unaudited": True} if info.manifest.unaudited else {})}  # labelled "not yet audited"
    coverage, listing = entry.coverage_for(concept_operation), subject["listing"]
    market = listing and (listing["operating_mic"] or listing["mic"])
    # A curated subject outside the hierarchy (a market, index, pair or series) is addressed as itself; one with
    # no asset class (a currency pair, a yield, a commodity future) is covered wherever the plugin addresses it.
    curated = subject["level"] not in INSTRUMENT_KINDS
    via = subject["level"] if curated else entry.via
    if coverage.asset_classes is not None and subject["asset_class"] not in coverage.asset_classes and not (
            curated and subject["asset_class"] is None):
        return {**answer, "status": "not_covering",
                "reason": f"{info.label} does not cover {subject['asset_class'] or 'this kind of'} instruments"}
    if coverage.markets is not None and market not in coverage.markets:
        return {**answer, "status": "not_covering", "reason": f"{info.label} does not cover {market or 'this market'}"}
    target = subject["ids"].get(via)
    row = stored(target, info.manifest.provider) if target and _addressable(info, via, subject) else None
    derived = None if row or not target or not _addressable(info, via, subject) else derive(info, via, subject, coins)
    wants_resolve = (bool(target) and _addressable(info, via, subject) and not row and not derived
                     and bool(resolve_input(info, subject)))
    if not (row or derived or wants_resolve):
        return {**answer, "status": "not_addressable", "reason": f"{info.label} has no address for this {subject['level']}"}
    missing = info.missing[0] if info.missing else None
    queued = next((item for item in queue if item["plugin"] == info.manifest.plugin), None)
    conflict = queued if queued and queued.get("kind", "conflict") == "conflict" else None
    if not info.enabled:
        return {**answer, "status": "disabled", "reason": f"{info.label} is disabled"}
    if missing:
        return {**answer, "status": "needs_configuration",
                "reason": f"{info.label} needs configuration: add {missing['key']} to {missing['file']}"}
    if (conflict and not (row and row["status"] == "confirmed")) or (row and row["status"] == "conflicting"):
        return {**answer, "status": "conflict", "reason": f"{info.label}'s record contradicts the reference; queued for review"}
    missed = misses.get((target, info.key))  # a miss is recorded at the level the plugin addresses
    if wants_resolve and (queued or missed):
        reason = missed or (f"{info.label}'s answer is queued for review: "
                            f"{QUEUED.get(queued['reason'], queued['reason'].replace('_', ' '))}")
        # `queued`: a match held for review (ADR 0042 sign-off, several matches), not "no match"
        return {**answer, "status": "unresolved", "reason": reason, **({"queued": queued["reason"]} if queued else {})}
    if wants_resolve:
        return {**answer, "status": "resolving", "reason": f"Looking up in {info.label}"}
    if row:
        ref, state = ProviderRef(row["provider"], row["native_id"], row["native_scope"]), row["status"]
    else:
        ref, rule = derived
        state = "confirmed" if rule in (CANONICAL_ASSETS_RULE, MARKETS_RULE) else "derived"
    request = None
    if section in (Section.PROFILE, Section.FILINGS, Section.LIVE):
        if operation not in info.operations:  # the contract names it, but no native tool declares it
            return {**answer, "status": "unresolved", "reason": f"{info.label} exposes no {section} operation"}
        arguments = {"native_ref": ref.wire()}
        if section is Section.LIVE:  # a live_market snapshot names its subject
            arguments["subject_id"] = subject["id"]
        request = {"plugin": info.key, "operation": operation, "arguments": arguments}
    serves(ref, target)  # an explicit read of this reference is checked for this subject
    check = checked(target, ref)
    refused = sorted(set(json.loads(check["differs"])) & ENFORCED) if check else []
    if refused:
        return {**answer, "status": "conflict", "binding": ref.wire(),
                "reason": f"{info.label} states another {' and '.join(refused)} than the reference; not used"}
    return {**answer, "binding": ref.wire(), "binding_status": state, "request": request,
            "verified_at": check["verified_at"] if check else None, "unverified": check["note"] if check else None}


def answers(subject: dict, plugins: list[PluginInfo], section: Section, *, order: tuple[str, ...] = (),
            **lookups: Any) -> list[dict]:
    """Every declaring plugin's answer for one section, in the investor's order, then core's default order."""
    return [answer for info in ordered(plugins, section, order)
            if (answer := evaluate(info, section, subject, **lookups)) is not None]


def price_sources(subject: dict, plugins: list[PluginInfo], **lookups: Any) -> list[dict]:
    """The native references that serve the subject's quote and chart now, in selection order.

    Market-data reads of a subject route through these: confirmed bindings and addresses core
    derives. A plugin that is disabled, unconfigured, not covering, contradicted or still
    needs a resolve contributes none."""
    refs: list[dict] = []
    for section in (Section.QUOTE, Section.CHART):
        for answer in answers(subject, plugins, section, **lookups):
            if answer["status"] == "ready" and answer["binding"] and answer["binding"] not in refs:
                refs.append(answer["binding"])
    return refs


def source(answer: dict) -> dict:
    """A source as page sections and agent results name it; one not yet signed off says so."""
    return {"source": answer["label"], "provider": answer["provider"], "plugin": answer["plugin"],
            **({"unaudited": True} if answer.get("unaudited") else {})}


def filings_request(subject: dict, use: str | None = None) -> dict:
    """Core's combined filings read of a subject's issuer, one list for all its listings; `use` reads one named
    source for its authorities, once."""
    return {"plugin": CORE_PLUGIN, "operation": "filings", "arguments": {
        "subject_id": subject["ids"].get(Level.ISSUER) or subject["id"], **({"use": use} if use else {})}}


def compose(subject: dict, plugins: list[PluginInfo], **lookups: Any) -> list[dict]:
    """One section per concept a plugin can serve for the subject: the chosen source, the other eligible sources
    as alternatives and every other declaring source as skipped with its reason. Filings combine one source per
    authority into one core read. Pure: the lookups are in-memory, so composition does no I/O."""
    order = tuple(lookups.get("order", ()))
    sections = []
    for section in SECTIONS:
        found = answers(subject, plugins, section, **lookups)
        own = core_section(subject, section is Section.QUOTE, found)  # says why no source can serve it
        if not own and not any(answer["status"] not in ABSENT for answer in found):
            continue
        combine = REGISTRY[SERVES[section][0]].combine
        chosen, alternatives, skipped = select(found, combine=combine)
        # A combined section reads its ready sources at once; one still to be looked up is listed (the read is
        # partial), not awaited, and the Desk looks it up as it does a resolving section.
        ready = [(answer, served) for answer, served in chosen if answer["status"] == "ready"]
        combined = combine is Combine.PER_AUTHORITY and bool(ready)
        waiting = [answer for answer, _ in chosen if answer["status"] != "ready"] if combined else []
        chosen = ready if combined else chosen
        lead = dict(chosen[0][0]) if chosen else next((a for a in found if a["status"] not in ABSENT), {**found[0], **(own or {})})
        rest = [answer for answer in skipped if answer["plugin"] != lead["plugin"]]
        lead["source"] = source(lead)
        lead["skipped"] = [{**source(answer), "label": answer["label"], "code": answer["status"],
                            "reason": answer["reason"] or answer["status"].replace("_", " ")} for answer in waiting + rest]
        lead["alternatives"] = [{**source(answer), "label": answer["label"], "status": answer["status"],
                                 "authorities": answer["authorities"], "binding": answer["binding"],
                                 "request": filings_request(subject, answer["plugin"]) if combined and answer["status"] == "ready" else answer["request"]}
                                for answer in alternatives]
        if combined:
            lead["sources"] = [{**source(answer), "authorities": list(served), "status": answer["status"]}
                               for answer, served in chosen]
            lead["label"] = " + ".join(answer["label"] for answer, _ in chosen)
            lead.update(status="ready", reason=None, request=filings_request(subject))
        # Amber only when a source ranked ahead of the one serving could have served and did not: the investor
        # named it, or something went wrong (contradicted, not found). Setup states are not warnings.
        served = {entry["plugin"] for entry, _ in chosen} or {lead["plugin"]}
        position = min((index for index, answer in enumerate(found) if answer["plugin"] in served), default=0)
        notice = next((answer for answer in found[:position] if answer["status"] not in ABSENT
                       and (answer["status"] in NOTICE or answer["plugin"] in order or answer["provider"] in order)), None)
        lead["notice"] = {**source(notice), "code": notice["status"], "reason": notice["reason"]} if notice else None
        sections.append(lead)
    return sections


# ---- applying one resolve answer --------------------------------------------------------------------------------

def apply_resolve(batch: ClaimBatch, info: PluginInfo, level: Level, subject: dict, sent: Mapping[str, str], *,
                  now: str, as_of: str | None = None, bound_to: Callable[[ProviderRef], str | None] = lambda ref: None) -> tuple[Binding | None, QueueItem | None, list[RecordClaim]]:
    """Decide a resolve answer with the one authority rule: a binding, a queue item, or neither (no match).

    The answer names a native reference for the identifiers core sent (`sent`). Rule
    `resolve_answer@1` binds it to the subject unless identifier evidence or the
    depositary-receipt guard contradicts it, or `bound_to` says the reference is already
    confirmed for another subject (a conflict, never a re-point); several references are a residual.
    A source not yet signed off (ADR 0042) never confirms: an answer that would bind is an `unaudited` residual
    for review, with the evidence that matched.
    """
    target, plugin = subject["ids"][level], info.manifest.plugin
    records = [claim for claim in batch.claims if isinstance(claim, RecordClaim) and claim.native_ref is not None
               and (scope := info.manifest.native_scope(claim.native_ref.native_scope)) is not None
               and scope.level is level]
    if not records:
        return None, None, []
    evidence_ids = tuple(item.evidence_id for item in subject["evidence"] if sent.get(item.scheme) == item.value)
    ref = records[0].native_ref
    base = {"candidate_ids": (target,), "state": "open", "opened_at": now, "plugins": (plugin,), "provider_ref": ref}
    # The record's own kind names what it is: a provider's index or FX record is never provisionally a security.
    local = (provisional_id(KIND_OF_RECORD.get(records[0].attributes.kind, level), ref.provider, ref.native_scope,
                            ref.native_id),)
    if len({(claim.native_ref.native_scope, claim.native_ref.native_id) for claim in records}) > 1:
        return None, QueueItem(id=uuid.uuid4().hex, kind="residual", reason="ambiguous", subject_ids=local,
                               evidence_ids=(), **base), records
    item = QueueItem(id=uuid.uuid4().hex, kind="residual", reason="no_key", subject_ids=local, evidence_ids=(), **base)
    if records[0].attributes.kind in KIND_OF_RECORD:  # an index or FX record: its own subject, never this instrument
        return None, item, records
    verdict = Verdict(item_id=item.id, resolver="rules", authority="rule_confirmed", relation=SAME[level],
                      chosen_id=target, rule_id=RESOLVE_RULE,
                      provenance={"plugin": "pythia", "source": "pythia", "adapter_version": "1", "retrieved_at": now})
    kind = subject["kind"]
    outcome = decide(verdict, item, claimed=records[0].identifiers, evidence=subject["evidence"],
                     as_of=as_of or date.today().isoformat(), record_kind=records[0].attributes.kind,
                     subject_kind=kind if kind in set(InstrumentKind) else None)
    other = bound_to(ref)
    confirms = outcome is VerdictOutcome.CONFIRMED and bool(evidence_ids)
    if confirms and other not in (None, target):
        return None, QueueItem(id=item.id, kind="conflict", reason="binding", subject_ids=(other, target),
                               evidence_ids=evidence_ids, **base), records
    if confirms and info.manifest.unaudited:
        return None, QueueItem(id=item.id, kind="residual", reason="unaudited", subject_ids=local,
                               evidence_ids=evidence_ids, **base), records
    if confirms:
        return Binding(provider_ref=ref, subject_id=target, status="confirmed", authority="rule_confirmed",
                       evidence_ids=evidence_ids, plugin=plugin, rule_id=RESOLVE_RULE), None, records
    cited = evidence_ids or tuple(item.evidence_id for item in subject["evidence"])
    if outcome is VerdictOutcome.BLOCKED and cited:
        return None, QueueItem(id=item.id, kind="conflict", reason="binding", subject_ids=(target,), evidence_ids=cited,
                               **base), records
    return None, item, records
