"""Instrument page composition (ADR 0038): the subject, its listings and one plugin per section.

`subject_view` is local only: it reads the reference file, the identity store and
the installed plugins' contracts, and never calls a plugin. A plugin whose
contract lets core build its native reference from open identifiers (a MIC
suffix table, an identifier-named native scope, the curated native-coin table)
is addressed at once; that derived reference is an address, never identifier
evidence. Only when core cannot derive the address is the section `resolving`:
the Desk then asks for that plugin's resolve (`identity-resolve`), which
`apply_resolve` decides with the one authority rule.
"""
from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable, Mapping

from .claims import ClaimBatch, RecordClaim
from .manifest import Manifest, Section
from .model import Binding, IdentifierAssertion, ProviderRef
from .resolution import QueueItem, Verdict, VerdictOutcome, decide
from .schemes import Level, provisional_id, subject_level
from .vocabulary import InstrumentKind, VerdictRelation

SECTIONS = (Section.QUOTE, Section.CHART, Section.PROFILE, Section.FILINGS)
ORDER = {Section.QUOTE: ("yahoo", "eodhd", "coinmarketcap", "coingecko"),
         Section.CHART: ("yahoo", "eodhd", "coinmarketcap", "coingecko"),
         Section.PROFILE: ("gleif",), Section.FILINGS: ("xbrl-filings", "sec")}
LABELS = {"yahoo": "Yahoo Finance", "eodhd": "EODHD", "coinmarketcap": "CoinMarketCap", "coingecko": "CoinGecko",
          "gleif": "GLEIF", "xbrl-filings": "filings.xbrl.org", "sec": "SEC EDGAR", "openfigi": "OpenFIGI"}
SAME = {Level.LISTING: VerdictRelation.SAME_LISTING, Level.COMPOSITE: VerdictRelation.SAME_COMPOSITE,
        Level.SECURITY: VerdictRelation.SAME_SECURITY, Level.ISSUER: VerdictRelation.SAME_ISSUER}
RESOLVE_RULE = "resolve_answer@1"  # a resolve answer to open identifiers binds unless identifier evidence contradicts it
NATIVE_COINS_RULE = "native_coins@1"


@dataclass(frozen=True)
class PluginInfo:
    """One installed plugin as core sees it, from its contract and native Hermes state."""

    key: str                                   # native plugin id: the `plugin` of Desk requests
    manifest: Manifest
    enabled: bool = True
    missing: tuple[Mapping[str, str], ...] = ()  # required configuration not configured
    operations: Mapping[str, str] = field(default_factory=dict)  # native tool -> declared HTTP operation

    @property
    def label(self) -> str:
        return LABELS.get(self.manifest.provider, self.manifest.provider)


def ordered(plugins: list[PluginInfo], section: Section) -> list[PluginInfo]:
    preferred = ORDER.get(section, ())
    rank = {name: index for index, name in enumerate(preferred)}
    return sorted(plugins, key=lambda info: (rank.get(info.manifest.provider, len(preferred)), info.key))


# ---- the subject from the reference file ------------------------------------------------------------------------

def load_subject(ref: sqlite3.Connection, subject_id: str) -> dict[str, Any] | None:
    """The subject with its listing, security and issuer (whichever exist), or None if unknown."""
    level = subject_level(subject_id)
    one = lambda sql, *args: ref.execute(sql, args).fetchone()  # noqa: E731
    listing = security = issuer = None
    if level is Level.LISTING:
        listing = one("SELECT * FROM listings WHERE id = ?", subject_id)
        security = listing and one("SELECT * FROM securities WHERE id = ?", listing["security_id"])
    elif level is Level.SECURITY:
        security = one("SELECT * FROM securities WHERE id = ?", subject_id)
    elif level is Level.ISSUER:
        issuer = one("SELECT * FROM issuers WHERE id = ?", subject_id)
        security = issuer and one("SELECT * FROM securities WHERE issuer_id = ? ORDER BY kind <> 'ordinary', status <> 'active',"
                                  " rank IS NULL, rank LIMIT 1", subject_id)
    if (listing or security or issuer) is None:
        return None
    if security is not None and listing is None:
        listing = one("SELECT * FROM listings WHERE security_id = ? ORDER BY is_primary DESC, status <> 'active', id LIMIT 1",
                      security["id"])
    if security is not None and issuer is None and security["issuer_id"]:
        issuer = one("SELECT * FROM issuers WHERE id = ?", security["issuer_id"])
    ids = {Level.LISTING: listing and listing["id"], Level.SECURITY: security and security["id"],
           Level.ISSUER: issuer and issuer["id"], Level.COMPOSITE: listing and listing["composite_id"]}
    subjects = [value for value in ids.values() if value]
    rows = ref.execute(f"SELECT * FROM assertions WHERE subject_id IN ({','.join('?' * len(subjects))})", subjects).fetchall()
    evidence = [_assertion(row) for row in rows]
    values: dict[str, str] = {}
    for item in evidence:
        values.setdefault(item.scheme, item.value)
    venues = {row["mic"]: row["name"] for row in ref.execute("SELECT mic, name FROM venues")}
    siblings = ref.execute("SELECT * FROM listings WHERE security_id = ? AND status <> 'inactive'"
                           " ORDER BY is_primary DESC, operating_mic, id", (security["id"],)).fetchall() if security else []
    name = (issuer["name"] if issuer and (security is None or security["asset_class"] != "crypto") else None) or (
        security["name"] if security else subject_id)
    identifiers = {"isin": values.get("isin"), "lei": values.get("lei"), "cik": values.get("cik"),
                   "figi": values.get("figi"), "caip19": values.get("caip19"),
                   "ticker": listing["ticker"] if listing else None, "mic": listing["operating_mic"] if listing else None,
                   "currency": listing["currency"] if listing else None}
    return {
        "id": subject_id, "level": level, "ids": ids, "values": values, "evidence": evidence,
        "asset_class": security["asset_class"] if security else None,
        "kind": security["kind"] if security else None,
        "listing": listing,
        "view": {
            "subject": {"id": subject_id, "level": str(level), "name": name, "kind": security["kind"] if security else None},
            "identifiers": {key: value for key, value in identifiers.items() if value},
            "issuer": {"id": issuer["id"], "name": issuer["name"], "lei": values.get("lei"), "cik": values.get("cik")}
            if issuer else None,
            "security": {"id": security["id"], "name": security["name"], "isin": values.get("isin")} if security else None,
            "listings": [{"id": row["id"], "ticker": row["ticker"], "mic": row["operating_mic"] or row["mic"],
                          "venue": venues.get(row["mic"] or ""), "currency": row["currency"], "primary": bool(row["is_primary"])}
                         for row in siblings],
        },
    }


def _assertion(row: sqlite3.Row) -> IdentifierAssertion:
    return IdentifierAssertion(
        subject_id=row["subject_id"], scheme=row["scheme"], value=row["value"], authority=row["authority"],
        provenance={"plugin": row["plugin"], "source": row["source"], "adapter_version": row["adapter_version"],
                    "retrieved_at": row["retrieved_at"], "source_record": row["source_record"]},
        validity={"valid_from": row["valid_from"], "valid_to": row["valid_to"]})


# ---- addressing -------------------------------------------------------------------------------------------------

def derive(info: PluginInfo, level: Level, subject: dict, coins: Callable[[str, str], str | None]) -> tuple[ProviderRef, str] | None:
    """A native reference core builds without a call, with the rule that built it, or None."""
    manifest, values, listing = info.manifest, subject["values"], subject["listing"]
    for scope in manifest.native:
        if scope.level is not level or (scope.asset_classes and subject["asset_class"] not in scope.asset_classes):
            continue
        if level is Level.SECURITY and subject["asset_class"] == "crypto" and values.get("caip19"):
            native = coins(manifest.provider, values["caip19"])
            if native:
                return ProviderRef(manifest.provider, native, scope.native_scope), NATIVE_COINS_RULE
        accepted = manifest.schemes.get(level, ())
        if scope.native_scope in accepted and values.get(scope.native_scope):
            return ProviderRef(manifest.provider, values[scope.native_scope], scope.native_scope), f"{scope.native_scope}_ref@1"
        if level is Level.LISTING and listing is not None and listing["ticker"] and listing["mic"]:
            suffix = manifest.mic_table.get(listing["operating_mic"] or listing["mic"])
            if suffix is not None:
                return ProviderRef(manifest.provider, listing["ticker"] + suffix, scope.native_scope), "mic_table@1"
    return None


def resolve_input(info: PluginInfo, subject: dict) -> dict[str, str]:
    """The subject's identifiers in the schemes the plugin's resolve accepts."""
    if info.manifest.resolve is None:
        return {}
    values, listing = dict(subject["values"]), subject["listing"]
    if listing is not None and listing["ticker"] and (listing["operating_mic"] or listing["mic"]):
        values.setdefault("ticker_mic", f"{listing['ticker']}@{listing['operating_mic'] or listing['mic']}")
    return {scheme: values[scheme] for scheme in info.manifest.resolve.input_schemes if values.get(scheme)}


def _addressable(info: PluginInfo, level: Level, subject: dict) -> bool:
    return any(scope.level is level and (not scope.asset_classes or subject["asset_class"] in scope.asset_classes)
               for scope in info.manifest.native)


def evaluate(info: PluginInfo, section: Section, subject: dict, *, stored: Callable[[str, str], sqlite3.Row | None],
             coins: Callable[[str, str], str | None], queue: list[dict]) -> dict | None:
    """One plugin's answer for one section, or None when it cannot address the subject."""
    entry = info.manifest.content.get(section)
    target = entry and subject["ids"].get(entry.via)
    if not target or not _addressable(info, entry.via, subject):
        return None
    row = stored(target, info.manifest.provider)
    derived = None if row else derive(info, entry.via, subject, coins)
    wants_resolve = not row and not derived and bool(resolve_input(info, subject))
    if not (row or derived or wants_resolve):
        return None
    answer = {"section": str(section), "plugin": info.key, "label": info.label, "status": "ready", "binding": None,
              "binding_status": None, "request": None, "alternatives": [], "reason": None}
    missing = info.missing[0] if info.missing else None
    conflict = next((item for item in queue if item["plugin"] == info.manifest.plugin), None)
    if not info.enabled:
        return {**answer, "status": "disabled", "reason": f"{info.label} is disabled"}
    if missing:
        return {**answer, "status": "needs_configuration",
                "reason": f"{info.label} needs configuration: add {missing['key']} to {missing['file']}"}
    if conflict or (row and row["status"] == "conflicting"):
        return {**answer, "status": "conflict", "reason": f"{info.label}'s record contradicts the reference; queued for review"}
    if wants_resolve:
        return {**answer, "status": "resolving", "reason": f"Looking up in {info.label}"}
    if row:
        ref, state = ProviderRef(row["provider"], row["native_id"], row["native_scope"]), row["status"]
    else:
        ref, rule = derived
        state = "confirmed" if rule == NATIVE_COINS_RULE else "derived"
    request = None
    if section in (Section.PROFILE, Section.FILINGS):
        operation = info.operations.get(entry.tool)
        if operation is None:
            return {**answer, "status": "unresolved", "reason": f"{info.label} exposes no {section} operation"}
        request = {"plugin": info.key, "operation": operation, "arguments": {"native_ref": ref.wire()}}
    return {**answer, "binding": ref.wire(), "binding_status": state, "request": request}


def compose(subject: dict, plugins: list[PluginInfo], **lookups: Any) -> list[dict]:
    """One chosen plugin per section (the first usable one in the default order), with the others as alternatives."""
    sections = []
    for section in SECTIONS:
        answers = [answer for info in ordered(plugins, section)
                   if (answer := evaluate(info, section, subject, **lookups)) is not None]
        if not answers:
            continue
        usable = [answer for answer in answers if answer["status"] in ("ready", "resolving", "conflict")]
        chosen = (usable or answers)[0]
        chosen["alternatives"] = [{"plugin": answer["plugin"], "label": answer["label"], "status": answer["status"]}
                                  for answer in answers if answer is not chosen]
        sections.append(chosen)
    return sections


# ---- applying one resolve answer --------------------------------------------------------------------------------

def apply_resolve(batch: ClaimBatch, info: PluginInfo, level: Level, subject: dict, sent: Mapping[str, str], *,
                  now: str, as_of: str | None = None) -> tuple[Binding | None, QueueItem | None, list[RecordClaim]]:
    """Decide a resolve answer with the one authority rule: a binding, a queue item, or neither (no match).

    The answer names a native reference for the identifiers core sent (`sent`). Rule
    `resolve_answer@1` binds it to the subject unless identifier evidence or the
    depositary-receipt guard contradicts it (a conflict); several references are a residual.
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
    local = (provisional_id(level, ref.provider, ref.native_scope, ref.native_id),)
    if len({(claim.native_ref.native_scope, claim.native_ref.native_id) for claim in records}) > 1:
        return None, QueueItem(id=uuid.uuid4().hex, kind="residual", reason="ambiguous", subject_ids=local,
                               evidence_ids=(), **base), records
    item = QueueItem(id=uuid.uuid4().hex, kind="residual", reason="no_key", subject_ids=local, evidence_ids=(), **base)
    verdict = Verdict(item_id=item.id, resolver="rules", authority="rule_confirmed", relation=SAME[level],
                      chosen_id=target, rule_id=RESOLVE_RULE,
                      provenance={"plugin": "pythia", "source": "pythia", "adapter_version": "1", "retrieved_at": now})
    kind = subject["kind"]
    outcome = decide(verdict, item, claimed=records[0].identifiers, evidence=subject["evidence"],
                     as_of=as_of or date.today().isoformat(), record_kind=records[0].attributes.kind,
                     subject_kind=kind if kind in set(InstrumentKind) else None)
    if outcome is VerdictOutcome.CONFIRMED and evidence_ids:
        return Binding(provider_ref=ref, subject_id=target, status="confirmed", authority="rule_confirmed",
                       evidence_ids=evidence_ids, plugin=plugin, rule_id=RESOLVE_RULE), None, records
    cited = evidence_ids or tuple(item.evidence_id for item in subject["evidence"])
    if outcome is VerdictOutcome.BLOCKED and cited:
        return None, QueueItem(id=item.id, kind="conflict", reason="binding", subject_ids=(target,), evidence_ids=cited,
                               **base), records
    return None, item, records
