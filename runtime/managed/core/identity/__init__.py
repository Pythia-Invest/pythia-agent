"""Pythia identity backbone contracts (ADR 0037, ADR 0038).

Core-owned meaning shared by every plugin: subject kinds and levels, identifier schemes,
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
    RecordClaim, RelationClaim, batch_from_json, batch_to_json, check_batch,
)
from .manifest import MANIFEST_FILE, CatalogueMode, Manifest, ManifestError, Section, validate_manifest
from .model import (
    Binding, Composite, IdentifierAssertion, Issuer, Listing, Provenance, ProviderRef, Relation, Security,
    Subject, Validity, evidence_id, fold_roots,
)
from .resolution import (
    QueueItem, QueueItemKind, QueueReason, QueueState, ResolverKind, Verdict, VerdictOutcome, contradicts, corroborates,
    decide,
    guarded,
)
from .schemes import (
    INSTRUMENT_KINDS, SCHEME_LEVEL, IdentifierError, Kind, Level, Scheme, normalize_identifier, provisional_id,
    subject_id, subject_kind, subject_level, ticker_mic,
)
from .vocabulary import (
    AUTHORITY_TIER, RELATIONS, AssetClass, Authority, BindingStatus, EvidenceTier, Grouping, IdentifierRole,
    InstrumentKind, RelationRule, RelationType, SubjectStatus, VerdictRelation,
)

class Store(StrEnum):
    """Backbone stores, each with its own SQLite schema."""

    REFERENCE = "reference"  # reference.sqlite3, built on the device, read-only between builds
    IDENTITY = "identity"    # identity.sqlite3: device decisions plus plugin-tagged provider claims


def schema_sql(store: Store | str) -> str:
    """The DDL for one store. Callers own connections, transactions and file privacy."""
    return (Path(__file__).parent / "sql" / f"{Store(store).value}.sql").read_text(encoding="utf-8")


__all__ = [name for name in dir() if not name.startswith("_") and name not in {"annotations", "Path", "StrEnum"}]
