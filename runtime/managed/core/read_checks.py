"""Read checks (ADR 0037): what a source's own read states about the reference it served, against the reference.

Core serves a subject through addresses it derives (a ticker and MIC suffix table) or
binds. Market data describes each reference before reading it, whether core routed it for
a subject or the caller named it (the Desk page and the agent read the reference the page
chose). The currency and venue that answer states are checked here, once per window, with
rule `read_check@1`, and kept per subject in `read_checks`. A read that agrees stamps
`verified_at`; otherwise the page and the agent see a label ("venue differs"). A difference refuses the source only for an attribute in `page.ENFORCED`, which
stays empty until the reference field it compares against is signed off. Nothing here
calls a provider or opens a Repairs item, and a failure never fails the read.
"""
from __future__ import annotations

import logging
import time
import weakref
from typing import TYPE_CHECKING, Any, Mapping

from .identity import Level, page
from .identity.model import ProviderRef
from .identity.schemes import CURRENCY

if TYPE_CHECKING:
    from .identity_ops import Identity

logger = logging.getLogger(__name__)
CHECK_EVERY = 15 * 60  # seconds: one check per subject, reference and stated values in this window, per process
STATED = ("currency", "venue")  # what a read states about itself; no price source states an ISIN today
MINOR_UNITS = {"GBX": "GBP", "ILA": "ILS", "ZAC": "ZAR"}  # a price in minor units trades in the major currency
UNCHECKED = {"status": "unchecked", "label": None}
_BOUND = 4096  # entries each per-process map keeps before it starts over


class State:
    """Per core identity (process): recent checks, and the subject each reference was last served for (so an
    explicit read of it is checked against that subject)."""

    def __init__(self) -> None:
        self.checked: dict[tuple, tuple[dict, float]] = {}
        self.served: dict[tuple[str, str, str], str] = {}


_STATES: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def state(identity: Identity) -> State:
    return _STATES.setdefault(identity, State())


def lookups(identity: Identity, subject_ids: list[str]) -> dict[str, Any]:
    """Page composition's view of the subjects' read checks, and where it records what it serves."""
    rows, served = identity.store.read_checks(subject_ids), state(identity).served

    def serve(ref: ProviderRef, subject_id: str) -> None:
        if len(served) > _BOUND:
            served.clear()
        served[_key(ref)] = subject_id
    return {"checked": lambda subject_id, ref: rows.get((subject_id, *_key(ref))), "serves": serve}


def check_read(identity: Identity, subject_id: str | None, native_ref: dict, stated: dict) -> dict:
    """Check what one read of a reference states about itself against the subject it serves.

    Returns {"status", "label"}: `verified`, `unverified` (served; `label` says why), `refused` (an enforced
    difference: the source is not used) or `unchecked` (nothing comparable, or no subject it serves)."""
    try:
        ref = ProviderRef(native_ref["provider"], native_ref["native_id"], native_ref["native_scope"])
        said = {key: value for key, value in (stated or {}).items() if key in STATED and isinstance(value, str) and value}
        subject_id = subject_id or state(identity).served.get(_key(ref))
        if not (said and subject_id):
            return UNCHECKED
        key = (subject_id, *_key(ref), tuple(sorted(said.items())))
        known = state(identity).checked.get(key)
        if known and known[1] > time.monotonic():
            return known[0]
        outcome = _check(identity, subject_id, ref, said)
    except Exception:  # a check never fails the read it rides on
        logger.warning("read check of %s failed", native_ref, exc_info=True)
        return UNCHECKED
    if len(state(identity).checked) > _BOUND:
        state(identity).checked.clear()
    state(identity).checked[key] = (outcome, time.monotonic() + CHECK_EVERY)
    return outcome


def compare(info: page.PluginInfo, subject: dict, stated: Mapping[str, str]) -> tuple[dict, list[str]]:
    """What one read states (its venue code mapped through the contract's `venue_codes`) and which stated
    attributes the subject's reference gives otherwise: `venue`, a venue where the security has no line (the
    venues its listing rows are keyed on); `currency`, another currency than the listing's (minor units count
    as their major). The venue a source states is compared, never inferred from a symbol's suffix. Names,
    instrument types, unmapped venue codes and anything unstated are never compared."""
    listing = subject["listing"]
    code = stated.get("currency", "").strip()
    currency = {"GBp": "GBX", "ZAc": "ZAC"}.get(code, code.upper())
    venue = stated.get("venue", "").strip()[:16]
    said = {key: value for key, value in (("currency", currency if CURRENCY.match(currency) else None),
                                           ("venue", venue or None),
                                           ("operating_mic", info.manifest.venue_codes.get(venue))) if value}
    differs = []
    lines = {line["mic"] for line in subject["view"]["listings"]} | (
        {listing["operating_mic"] or listing["mic"]} if listing else set())
    if said.get("operating_mic") and lines - {None} and said["operating_mic"] not in lines:
        differs.append("venue")
    trading = listing and listing["trading_currency"]  # None: no source states it, nothing to compare
    if said.get("currency") and trading and MINOR_UNITS.get(currency, currency) != MINOR_UNITS.get(trading, trading):
        differs.append("currency")
    return said, differs


def _check(identity: Identity, subject_id: str, ref: ProviderRef, said: dict) -> dict:
    from .identity_ops import installed
    _path, subject, lookups, _issue = identity._load(subject_id)
    plugins = installed()
    served = next((answer for section in (page.Section.QUOTE, page.Section.CHART)
                   for answer in page.answers(subject, plugins, section, **lookups)
                   if answer["binding"] and ProviderRef(**answer["binding"]) == ref), None) if subject else None
    if served is None:  # not a reference core serves this subject through
        return UNCHECKED
    info = next(item for item in plugins if item.key == served["plugin"])
    stated, differs = compare(info, subject, said)
    comparable = (("operating_mic" in stated and subject["view"]["listings"])
                  or ("currency" in stated and subject["listing"] and subject["listing"]["trading_currency"]))
    if not comparable:
        return UNCHECKED
    note = " and ".join(differs) + (" differ" if len(differs) > 1 else " differs") if differs else None
    identity.store.put_read_check(subject["ids"][Level(served["via"])], ref, info.manifest.plugin, stated, differs, note)
    if note:
        logger.info("%s read of %s for %s: unverified (%s)", info.label, ref.native_id, subject_id, note)
    status = "refused" if set(differs) & page.ENFORCED else "unverified" if note else "verified"
    return {"status": status, "label": note}


def _key(ref: ProviderRef) -> tuple[str, str, str]:
    return ref.provider, ref.native_scope, ref.native_id
