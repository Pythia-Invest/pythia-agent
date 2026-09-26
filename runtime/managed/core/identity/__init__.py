"""Pythia identity backbone contracts (ADR 0037, ADR 0038).

Core-owned meaning shared by every plugin: subject levels, identifier schemes,
evidence tiers, typed claims, the resolution queue and its authority rule, the
store schemas and the plugin contract manifest. Plugins reach
it through the loaded core module's `identity` attribute. Pure standard
library; no I/O at import.
"""
from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from .claims import (
    BatchOrigin, Claim, ClaimBatch, ClaimEmitter, ClaimError, Deployment, EmitReceipt, IdentifierValue,
    RecordAttributes,
    RecordClaim, RelationClaim, check_batch,
)
from .manifest import MANIFEST_FILE, CatalogueMode, Manifest, ManifestError, Section, validate_manifest
from .model import (
    Binding, Composite, IdentifierAssertion, Issuer, Listing, Provenance, ProviderRef, Relation, Security,
    Subject, Validity, evidence_id,
)
from .resolution import (
    QueueItem, QueueItemKind, QueueReason, QueueState, ResolverKind, Verdict, VerdictOutcome, contradicts, decide,
    guarded,
)
from .schemes import (
    SCHEME_LEVEL, IdentifierError, Level, Scheme, normalize_identifier, provisional_id, subject_id, subject_level,
    ticker_mic,
)
from .vocabulary import (
    AUTHORITY_TIER, AssetClass, Authority, BindingStatus, EvidenceTier, IdentifierRole, InstrumentKind, RelationType,
    SubjectStatus, VerdictRelation,
)

class Store(StrEnum):
    """Backbone stores, each with its own SQLite schema."""

    REFERENCE = "reference"  # reference.sqlite3, built on the device, read-only between builds
    IDENTITY = "identity"    # identity.sqlite3, the private identity store
    OVERLAY = "overlay"      # overlay-<plugin>.sqlite3, one per bulk-catalogue plugin


def schema_sql(store: Store | str) -> str:
    """The DDL for one store. Callers own connections, transactions and file privacy."""
    return (Path(__file__).parent / "sql" / f"{Store(store).value}.sql").read_text(encoding="utf-8")


__all__ = [name for name in dir() if not name.startswith("_") and name not in {"annotations", "Path", "StrEnum"}]
