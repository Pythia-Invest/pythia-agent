"""Typed claims plugins emit into the backbone, and the emission API connectors call.

Plugins describe their own records; they never reconcile. A record or relation
claim names subjects only by global identifiers, and a record may bind only the
emitting provider's own native references. Pythia subject IDs appear only in
resolver verdicts on the core's queue (see resolution.py), never in claims.
Plugins never choose an evidence tier: the core assigns it at ingest.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Mapping, Protocol

from .manifest import CatalogueMode, Manifest
from .model import Provenance, ProviderRef, Validity, _coerce, _require
from .schemes import (
    COUNTRY, CURRENCY, DECIMAL, LICENSED_SCHEMES, MIC, SCHEME_LEVEL, TICKER_CLASS, TICKER_ROOT, Level, Scheme,
    normalize_identifier,
)
from .vocabulary import (
    RELATION_LEVELS, AssetClass, IdentifierRole, InstrumentKind, Redistribution, RelationType, SubjectStatus,
)

MAX_BATCH_CLAIMS = 5000
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}


class BatchOrigin(StrEnum):
    CATALOGUE = "catalogue"  # a page of a bulk catalogue scope
    RESOLVE = "resolve"      # the answer to one budgeted resolve request
    REFERENCE = "reference"  # an open reference source run by the reference builder


@dataclass(frozen=True, slots=True)
class IdentifierValue:
    scheme: Scheme
    value: str
    role: IdentifierRole = IdentifierRole.SELF

    def __post_init__(self) -> None:
        _coerce(self, scheme=Scheme, role=IdentifierRole)
        object.__setattr__(self, "value", normalize_identifier(self.scheme, self.value))

    @property
    def level(self) -> Level:
        return SCHEME_LEVEL[self.scheme]


@dataclass(frozen=True, slots=True)
class RecordAttributes:
    """Descriptive fields of a source record. None means the source did not say."""

    name: str | None = None
    issuer_name: str | None = None
    ticker_root: str | None = None
    ticker_class: str | None = None
    mic: str | None = None
    operating_mic: str | None = None
    provider_venue: str | None = None  # the provider's own exchange code, kept for its MIC crosswalk
    currency: str | None = None
    price_scale: str | None = None
    country: str | None = None
    asset_class: AssetClass | None = None
    kind: InstrumentKind | None = None
    cfi: str | None = None
    status: SubjectStatus | None = None
    aliases: tuple[str, ...] = ()
    rank: Mapping[str, float] = field(default_factory=dict)  # rank signals, e.g. {"market_cap_usd": 2.6e11}

    def __post_init__(self) -> None:
        _coerce(self, asset_class=AssetClass, kind=InstrumentKind, status=SubjectStatus)
        object.__setattr__(self, "aliases", tuple(self.aliases))
        checks = ((self.ticker_root, TICKER_ROOT), (self.ticker_class, TICKER_CLASS), (self.mic, MIC),
                  (self.operating_mic, MIC), (self.currency, CURRENCY), (self.price_scale, DECIMAL), (self.country, COUNTRY))
        _require(all(value is None or bool(pattern.match(value)) for value, pattern in checks),
                 "record attributes: malformed ticker, MIC, currency, scale or country")
        _require(all(isinstance(key, str) and isinstance(value, (int, float)) for key, value in self.rank.items()),
                 "record attributes: rank signals are numeric")


@dataclass(frozen=True, slots=True)
class RecordClaim:
    """One source record at its native level, with the identifiers it co-asserts."""

    level: Level
    identifiers: tuple[IdentifierValue, ...]
    provenance: Provenance
    attributes: RecordAttributes = field(default_factory=RecordAttributes)
    native_ref: ProviderRef | None = None
    validity: Validity = field(default_factory=Validity)

    def __post_init__(self) -> None:
        _coerce(self, level=Level, provenance=Provenance, attributes=RecordAttributes, native_ref=ProviderRef,
                validity=Validity)
        object.__setattr__(self, "identifiers", tuple(
            item if isinstance(item, IdentifierValue) else IdentifierValue(**item) for item in self.identifiers))
        _require(bool(self.identifiers) or self.native_ref is not None, "record: identifiers or a native ref required")
        for item in self.identifiers:
            # A record speaks for itself and its parents, never for narrower subjects,
            # except that a crypto asset record may list its CAIP-19 deployments.
            deployment = item.scheme is Scheme.CAIP19 and self.level is Level.SECURITY
            _require(_DEPTH[item.level] <= _DEPTH[self.level] or deployment,
                     f"record: a {self.level} record cannot assert {item.scheme}")


@dataclass(frozen=True, slots=True)
class RelationClaim:
    """A typed edge between subjects named by global identifiers."""

    type: RelationType
    from_key: IdentifierValue
    to_key: IdentifierValue
    provenance: Provenance
    validity: Validity = field(default_factory=Validity)
    ratio: str | None = None
    parent_kind: str | None = None

    def __post_init__(self) -> None:
        _coerce(self, type=RelationType, from_key=IdentifierValue, to_key=IdentifierValue, provenance=Provenance,
                validity=Validity)
        _require((self.from_key.level, self.to_key.level) == RELATION_LEVELS[self.type],
                 f"relation claim: {self.type} keys at the wrong levels")
        _require(self.from_key != self.to_key, "relation claim: endpoints must differ")
        _require(self.ratio is None or (self.type is RelationType.DEPOSITARY_RECEIPT_OF and bool(DECIMAL.match(self.ratio))),
                 "relation claim: ratio is a decimal on receipts only")
        _require((self.parent_kind in ("direct", "ultimate")) == (self.type is RelationType.PARENT_OF),
                 "relation claim: parent_kind is direct or ultimate on parent_of only")


Claim = RecordClaim | RelationClaim


@dataclass(frozen=True, slots=True)
class ClaimBatch:
    plugin: str
    provider: str
    adapter_version: str
    origin: BatchOrigin
    claims: tuple[Claim, ...]
    scope: str | None = None  # catalogue scope
    complete: bool = False    # last page of the scope: rows not seen become "not seen", never unbound

    def __post_init__(self) -> None:
        _coerce(self, origin=BatchOrigin)
        object.__setattr__(self, "claims", tuple(self.claims))
        _require(0 < len(self.claims) <= MAX_BATCH_CLAIMS or (self.complete and not self.claims),
                 f"batch: 1-{MAX_BATCH_CLAIMS} claims")
        _require((self.origin is BatchOrigin.CATALOGUE) == (self.scope is not None), "batch: scope exactly for catalogue pages")


@dataclass(frozen=True, slots=True)
class EmitReceipt:
    accepted: int
    residuals: int
    conflicts: int
    rejected: tuple[tuple[int, str], ...] = ()  # (claim index, reason) for claims the core refused


class ClaimEmitter(Protocol):
    """Connector entry point, exposed by the loaded core as `identity.emitter()`.

    `emit` validates with `check_batch`, joins at ingest and returns promptly; it
    never calls a provider. A rejected batch raises ClaimError and stores nothing.
    """

    def emit(self, batch: ClaimBatch) -> EmitReceipt: ...


class ClaimError(ValueError):
    pass


def _fail(index: int | None, reason: str) -> ClaimError:
    return ClaimError(f"claims[{index}]: {reason}" if index is not None else f"batch: {reason}")


def check_batch(batch: ClaimBatch, manifest: Manifest) -> None:
    """Mechanical contract checks for a batch against its plugin's validated manifest."""
    if (batch.plugin, batch.provider) != (manifest.plugin, manifest.provider):
        raise _fail(None, "plugin or provider differs from the manifest")
    catalogue = manifest.catalogue
    if batch.origin is BatchOrigin.CATALOGUE:
        if catalogue is None or catalogue.mode is not CatalogueMode.BULK or batch.scope not in catalogue.scopes:
            raise _fail(None, "no declared bulk catalogue scope")
    if batch.origin is BatchOrigin.RESOLVE and manifest.resolve is None:
        raise _fail(None, "no declared resolve")
    may_open = catalogue is not None and catalogue.redistribution is Redistribution.OPEN
    seen: set[tuple[str, str]] = set()
    for index, claim in enumerate(batch.claims):
        provenance = claim.provenance
        if provenance.plugin != batch.plugin or provenance.adapter_version != batch.adapter_version:
            raise _fail(index, "provenance does not name this plugin and adapter version")
        if provenance.redistribution is Redistribution.OPEN and not may_open:
            raise _fail(index, "the manifest does not declare this source republishable")
        keys = claim.identifiers if isinstance(claim, RecordClaim) else (claim.from_key, claim.to_key)
        if provenance.redistribution is Redistribution.OPEN and any(item.scheme in LICENSED_SCHEMES for item in keys):
            raise _fail(index, "licensed identifiers cannot be marked open")
        if isinstance(claim, RecordClaim) and claim.native_ref is not None:
            ref = claim.native_ref
            declared = manifest.native_scope(ref.native_scope)
            if ref.provider != manifest.provider or declared is None:
                raise _fail(index, "a plugin binds only its own declared native references")
            if declared.level is not claim.level:
                raise _fail(index, f"{ref.native_scope} refs address a {declared.level}, not a {claim.level}")
            key = (ref.native_scope, ref.native_id)
            if key in seen:
                raise _fail(index, "duplicate native reference in batch")
            seen.add(key)
