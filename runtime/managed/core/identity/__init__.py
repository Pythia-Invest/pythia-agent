"""Pythia identity backbone and data contracts (ADR 0037, ADR 0038, ADR 0040).

Core-owned meaning shared by every plugin: subject kinds and levels, identifier schemes,
evidence tiers, typed claims, the resolution queue and its authority rule, the
store schemas, the plugin contract manifest, the data-concept registry and the `live_market` snapshot schema. Plugins reach
it through the loaded core module's `identity` attribute. Pure standard
library; no I/O at import.
"""
from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from .claims import (
    BatchOrigin, Claim, ClaimBatch, ClaimError, Deployment, EmitReceipt, IdentifierValue,
    RecordAttributes,
    RecordClaim, RelationClaim, SourceCorrection, batch_from_json, batch_to_json, check_batch,
)
from .concepts import REGISTRY, Combine, Concept, ConceptSpec, FilingAuthority, Licence
from .declared import DECLARED_RULE, DeclaredRef
from .live_market import LiveMarketError, validate_live_market
from .manifest import (
    CONTRACT_VERSION, MANIFEST_FILE, CatalogueMode, ConceptEntry, Coverage, Manifest, ManifestError,
    ManifestNeedsUpdate, SignOff, contract_version, validate_manifest,
)
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
    CANONICAL_ASSETS_RULE, CGS_AREA, INSTRUMENT_KINDS, KEY_RULE, SCHEME_LEVEL, IdentifierError, Kind, Level, Scheme,
    normalize_identifier, provisional_id, registered_kind, subject_id, subject_kind, subject_level, ticker_mic,
)
from .vocabulary import (
    AUTHORITY_TIER, RELATIONS, AssetClass, Authority, BindingStatus, EvidenceTier, Grouping, IdentifierRole,
    InstrumentKind, RelationRule, RelationType, SourceMeaning, SubjectStatus, VerdictRelation,
)

class Store(StrEnum):
    """Backbone stores, each with its own SQLite schema."""

    REFERENCE = "reference"  # reference.sqlite3, built on the device, read-only between builds
    IDENTITY = "identity"    # identity.sqlite3: device decisions plus plugin-tagged provider claims


def schema_sql(store: Store | str) -> str:
    """The DDL for one store. Callers own connections, transactions and file privacy."""
    return (Path(__file__).parent / "sql" / f"{Store(store).value}.sql").read_text(encoding="utf-8")


# Columns added to a table within a schema version: nullable, so a database made before one still reads. The DDL declares
# them too; SQLite has no `ADD COLUMN IF NOT EXISTS`, so each open adds what an older database lacks (`add_columns`).
ADDED_COLUMNS = {Store.IDENTITY: (("relations", "source_record TEXT"), ("relations", "source_version TEXT"),
                                  ("relations", "adapter_version TEXT"), ("relations", "role TEXT"),
                                  ("bindings", "decided_at TEXT"))}


def add_columns(db, store: Store | str) -> None:
    """Add to `db`, an open database of `store`, the `ADDED_COLUMNS` it lacks. The caller holds the store's lock."""
    for table, column in ADDED_COLUMNS.get(Store(store), ()):
        if column.split()[0] not in {row[1] for row in db.execute(f"PRAGMA table_info({table})")}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {column}")


__all__ = [name for name in dir() if not name.startswith("_") and name not in {"annotations", "Path", "StrEnum"}]
