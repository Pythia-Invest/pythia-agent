"""Pythia identity backbone contracts (ADR 0037, ADR 0038).

Core-owned meaning shared by every plugin: subject levels, identifier schemes,
evidence tiers, typed claims, the resolution queue and its authority rule, the
store schemas, the directory row and the plugin contract manifest. Plugins reach
it through the loaded core module's `identity` attribute and check
`API_VERSION`. Pure standard library; no I/O at import.
"""
from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from .claims import (
    BatchOrigin, Claim, ClaimBatch, ClaimEmitter, ClaimError, EmitReceipt, IdentifierValue, RecordAttributes,
    RecordClaim, RelationClaim, check_batch,
)
from .manifest import MANIFEST_FILE, PAGE_BUDGET, CatalogueMode, Manifest, ManifestError, Section, validate_manifest
from .model import (
    Binding, Composite, IdentifierAssertion, Issuer, Listing, Provenance, ProviderRef, Relation, Security,
    Subject, Validity, evidence_id,
)
from .resolution import (
    QueueItem, QueueItemKind, QueueReason, QueueState, ResolutionQueue, ResolverKind, Verdict, VerdictOutcome, decide,
)
from .schemes import SCHEME_LEVEL, IdentifierError, Level, Scheme, normalize_identifier, subject_level, ticker_mic
from .vocabulary import (
    AUTHORITY_TIER, JOIN_ORDER, AssetClass, Authority, BindingStatus, EvidenceTier, IdentifierRole, InstrumentKind,
    JoinRule, Redistribution, RelationType, SubjectStatus, VerdictRelation,
)

API_VERSION = 1


class Store(StrEnum):
    """Backbone stores and the SQLite `user_version` each schema carries."""

    REFERENCE = "reference"  # reference/<release>.sqlite3 (read-only) and reference-local.sqlite3
    IDENTITY = "identity"    # identity.sqlite3, v2 of the private identity store
    OVERLAY = "overlay"      # overlay-<plugin>.sqlite3, one per bulk-catalogue plugin
    DIRECTORY = "directory"  # directory.sqlite3, derived and rebuilt atomically

    @property
    def schema_version(self) -> int:
        return 2 if self is Store.IDENTITY else 1


def schema_sql(store: Store | str) -> str:
    """The DDL for one store. Callers own connections, transactions and file privacy."""
    return (Path(__file__).parent / "sql" / f"{Store(store).value}.sql").read_text(encoding="utf-8")


__all__ = [name for name in dir() if not name.startswith("_") and name not in {"annotations", "Path", "StrEnum"}]
