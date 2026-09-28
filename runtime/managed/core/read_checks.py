"""Read checks (ADR 0037): what a source's own read states about the reference it served, against the reference.

Core serves a subject through addresses it derives (a ticker and MIC suffix table) or
binds. Market-data already describes each routed reference before reading it; what that
answer states about itself (its ISIN, currency, venue) is checked here, once per window,
with rule `read_check@1`. A match stamps the binding's `verified_at`; a clear mismatch
opens a conflict in Repairs and the page stops serving a derived address. Nothing here
calls a provider.
"""
from __future__ import annotations

import dataclasses
import json
import logging
import sqlite3
import time
import uuid
from typing import TYPE_CHECKING, Mapping

from .identity import Level, page, store
from .identity.claims import RecordClaim
from .identity.model import ProviderRef
from .identity.resolution import QueueItem
from .identity.schemes import CURRENCY, IdentifierError, Scheme, normalize_identifier

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
CHECK_EVERY = 15 * 60  # seconds: one check per subject, reference and stated values in this window, per process
STATED = ("isin", "currency", "venue", "name")  # what a read may state about itself
MINOR_UNITS = {"GBX": "GBP", "ILA": "ILS", "ZAC": "ZAR"}  # a price in minor units trades in the major currency


def check_read(identity: Identity, subject_id: str, native_ref: dict, stated: dict) -> str:
    """Check what one read of a reference routed for a subject states about itself against the subject.

    Returns `verified` (a match stamps `verified_at`), `refused` (a mismatch: a conflict opens in Repairs and
    the page stops serving the reference), `questioned` (a mismatch on a confirmed binding: the question opens,
    the binding keeps serving) or `unchecked` (nothing comparable, or not a reference core serves now)."""
    try:
        ref = ProviderRef(native_ref["provider"], native_ref["native_id"], native_ref["native_scope"])
    except (KeyError, TypeError, ValueError):
        return "unchecked"
    said = {key: value for key, value in (stated or {}).items() if key in STATED and isinstance(value, str) and value}
    key = (subject_id, ref.provider, ref.native_scope, ref.native_id, tuple(sorted(said.items())))
    known = identity.checked.get(key)
    if known and known[1] > time.monotonic():
        return known[0]
    try:
        outcome = _check(identity, subject_id, ref, said) if said else "unchecked"
    except (sqlite3.Error, OSError, ValueError):
        logger.warning("read check of %s failed", ref.native_id, exc_info=True)
        return "unchecked"
    if outcome != "refused":  # a refused reference is not routed again until a verdict confirms it: check it then
        if len(identity.checked) > 4096:
            identity.checked.clear()
        identity.checked[key] = (outcome, time.monotonic() + CHECK_EVERY)
    return outcome


def compare(info: page.PluginInfo, subject: dict, ref: ProviderRef, stated: Mapping[str, str], *,
            now: str) -> tuple[RecordClaim, str | None, bool]:
    """What one read states about `ref`, as the plugin's record, and the first clear mismatch with the subject's
    reference data, with whether anything could be compared.

    Clear mismatches: another ISIN than the security's; another currency than the listing's trading currency
    (minor units count as their major currency); a venue, through the contract's `venue_codes`, where the
    security has no line. Names, instrument types, venue codes the contract does not map and anything the read
    does not state are never compared."""
    listing, values = subject["listing"], {key: value.strip() for key, value in stated.items()}
    try:
        isin = normalize_identifier(Scheme.ISIN, values["isin"].upper()) if values.get("isin") else None
    except IdentifierError:  # a malformed ISIN states nothing
        isin = None
    currency = {"GBp": "GBX", "ZAc": "ZAC"}.get(values.get("currency", ""), values.get("currency", "").upper())
    venue = values.get("venue", "")[:16]
    level = info.manifest.native_scope(ref.native_scope).level
    record = RecordClaim(
        level=level, native_ref=ref,
        identifiers=[{"scheme": "isin", "value": isin}] if isin and level != Level.ISSUER else [],
        attributes={"name": values.get("name", "")[:200] or None, "currency": currency if CURRENCY.match(currency) else None,
                    "provider_venue": venue or None, "operating_mic": info.manifest.venue_codes.get(venue)},
        provenance={"plugin": info.manifest.plugin, "source": info.manifest.provider, "adapter_version": page.READ_RULE,
                    "retrieved_at": now})
    mismatches, compared = [], False
    isins = {item.value for item in subject["evidence"] if item.scheme == "isin"}
    if record.identifiers and isins:
        compared = True
        if isin not in isins:
            mismatches.append(f"ISIN {isin}, not {', '.join(sorted(isins))}")
    trading, stated_currency = listing and listing["currency"], record.attributes.currency
    if stated_currency and trading:
        compared = True
        if MINOR_UNITS.get(stated_currency, stated_currency) != MINOR_UNITS.get(trading, trading):
            mismatches.append(f"currency {stated_currency}, not {trading}")
    mic = record.attributes.operating_mic
    lines = {line["mic"] for line in subject["view"]["listings"]} | (
        {listing["operating_mic"] or listing["mic"]} if listing else set())
    if mic and lines - {None}:
        compared = True
        if mic not in lines:
            mismatches.append(f"venue {venue} ({mic}), where this security has no line")
    return record, "; ".join(mismatches) or None, compared


def _check(identity: Identity, subject_id: str, ref: ProviderRef, said: dict) -> str:
    from .identity_ops import installed
    _path, subject, lookups, _issue = identity._load(subject_id)
    plugins = installed()
    served = next((answer for section in (page.Section.QUOTE, page.Section.CHART)
                   for answer in page.answers(subject, plugins, section, **lookups)
                   if answer["status"] == "ready" and answer["binding"]
                   and ProviderRef(**answer["binding"]) == ref), None) if subject else None
    if served is None:  # not a reference core serves this subject through now
        return "unchecked"
    info = next(item for item in plugins if item.key == served["plugin"])
    target, now = subject["ids"][Level(served["via"])], store.now()
    record, mismatch, compared = compare(info, subject, ref, said, now=now)
    if not compared:
        return "unchecked"
    evidence = tuple(dict.fromkeys(item.evidence_id for item in subject["evidence"]))
    identity_store = identity.store
    with identity_store.transaction():
        kept = identity_store.claim(info.manifest.plugin, ref)
        if kept is None or kept["provenance"]["adapter_version"] == page.READ_RULE:  # never over a resolve record
            identity_store.put_claim(info.manifest.plugin, ref.provider, json.loads(json.dumps(dataclasses.asdict(record))))
        identity_store.put_check(ref, target, info.manifest.plugin, page.READ_RULE, evidence, matched=not mismatch)
        if not mismatch:
            return "verified"
        row = identity_store.binding_for(ref)
        bound = row is not None and row["subject_id"] == target and row["status"] == "confirmed"
        item = QueueItem(id=uuid.uuid4().hex, kind="conflict", reason="binding", subject_ids=(target,),
                         candidate_ids=(target,), evidence_ids=evidence, state="open", opened_at=now,
                         plugins=(info.manifest.plugin,), provider_ref=ref) if evidence else None
        # A verdict already answered this question for the binding; a dismissal holds for the same evidence.
        if item and not (bound and row["verdict_id"]) and not identity_store.dismissed(item.key, item.evidence_ids):
            identity_store.put_queue_item(item)
    logger.warning("%s states %s for %s: queued for review", info.label, mismatch, target)
    return "questioned" if bound else "refused"
