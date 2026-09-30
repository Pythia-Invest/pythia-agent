"""How ingest names a record and ranks the keys of a subject it places (ADR 0037, amendment "ingest"). Pure functions."""
from __future__ import annotations

import hashlib
import json

from .claims import RecordClaim
from .model import ProviderRef

RANK = ("isin", "lei", "figi", "cik", "caip19", "cgs_isin", "pythia", "provisional")  # key schemes, best first
RECORD = "#record"  # the scope of a record kept by digest: no contract can declare it (a native scope is a namespace)


def claim_ref(provider: str, claim: RecordClaim) -> ProviderRef:
    """The key a record is kept under: its native reference, else a digest of its level and identifiers, so a renamed
    record keeps its row and a record naming other identifiers is another."""
    if claim.native_ref is not None:
        return claim.native_ref
    stated = json.dumps([str(claim.level), sorted((str(item.scheme), item.value, str(item.role))
                                                  for item in claim.identifiers)])
    return ProviderRef(provider, "sha256:" + hashlib.sha256(stated.encode()).hexdigest(), RECORD)


def ids(record: dict) -> list[str]:
    return sorted(json.dumps(item, sort_keys=True) for item in record.get("identifiers", []))


def tag(key: str) -> str:
    return key.split(":", 2)[1]


def better(key: str, current: str) -> bool:
    """Whether `key` ranks above the key scheme of `current` (subject_key@2's precedence)."""
    return RANK.index(tag(key)) < RANK.index(tag(current)) if tag(key) in RANK and tag(current) in RANK else False
