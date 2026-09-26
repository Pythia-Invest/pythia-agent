"""Typed backbone records: subjects per level, assertions, bindings and relations.

Constructors coerce plain strings/dicts (as read from JSON or SQLite rows) into
enums and nested records, then check what can be checked mechanically. A record
that constructs is well formed; it is not thereby true.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping

from .vocabulary import (
    AUTHORITY_TIER, CONFIRMING, RELATION_LEVELS, AssetClass, Authority, BindingStatus,
    EvidenceTier, InstrumentKind, RelationType, SubjectStatus,
)
from .schemes import (
    CAIP2, COUNTRY, CURRENCY, DATE, DECIMAL, INSTANT, MIC, NAMESPACE, SCHEME_LEVEL, TICKER, Level, Scheme,
    normalize_identifier, subject_level,
)


def _coerce(record: Any, **types: Any) -> None:
    """Coerce named fields from plain JSON/SQLite values into enums or nested records."""
    for name, target in types.items():
        value = getattr(record, name)
        if value is None or isinstance(value, target):
            continue
        if issubclass(target, StrEnum):
            object.__setattr__(record, name, target(value))
        elif isinstance(value, Mapping):
            object.__setattr__(record, name, target(**value))
        else:
            raise TypeError(f"{type(record).__name__}.{name}: expected {target.__name__}")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _text(value: Any, name: str, maximum: int = 512) -> None:
    _require(isinstance(value, str) and 0 < len(value) <= maximum, f"{name}: non-empty text required")


@dataclass(frozen=True, slots=True)
class Validity:
    """Inclusive ISO dates; None is open-ended. Resolution takes an `as_of` date."""

    valid_from: str | None = None
    valid_to: str | None = None

    def __post_init__(self) -> None:
        for value in (self.valid_from, self.valid_to):
            _require(value is None or bool(DATE.match(value)), "validity: dates must be YYYY-MM-DD")
        _require(self.valid_from is None or self.valid_to is None or self.valid_from <= self.valid_to,
                 "validity: valid_to precedes valid_from")

    def contains(self, as_of: str) -> bool:
        return (self.valid_from is None or self.valid_from <= as_of) and (
            self.valid_to is None or as_of <= self.valid_to)


@dataclass(frozen=True, slots=True)
class Provenance:
    """Who said it, from which record, and when."""

    plugin: str
    source: str
    adapter_version: str
    retrieved_at: str
    source_record: str | None = None
    source_version: str | None = None

    def __post_init__(self) -> None:
        _require(bool(NAMESPACE.match(self.plugin)), "provenance.plugin: native plugin name required")
        _require(bool(NAMESPACE.match(self.source.replace(".", "_"))), "provenance.source: namespace required")
        _text(self.adapter_version, "provenance.adapter_version", 64)
        _require(bool(INSTANT.match(self.retrieved_at)), "provenance.retrieved_at: ISO instant required")


@dataclass(frozen=True, slots=True)
class ProviderRef:
    """Exactly the existing market-data wire `provider_ref`; the read pipeline stays keyed by it."""

    provider: str
    native_id: str
    native_scope: str
    qualifiers: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require(bool(NAMESPACE.match(self.provider)), "provider_ref.provider: namespace required")
        _text(self.native_id, "provider_ref.native_id")
        _text(self.native_scope, "provider_ref.native_scope", 64)

    @property
    def namespace(self) -> str:
        return f"{self.provider}.{self.native_scope}"

    def wire(self) -> dict[str, Any]:
        value: dict[str, Any] = {"provider": self.provider, "native_id": self.native_id,
                                 "native_scope": self.native_scope}
        return {**value, "qualifiers": dict(self.qualifiers)} if self.qualifiers else value


def evidence_id(payload: Mapping[str, Any]) -> str:
    """Content-hashed evidence ID: an unchanged assertion keeps its ID across releases."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return "ev:" + hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class IdentifierAssertion:
    subject_id: str
    scheme: Scheme
    value: str
    authority: Authority
    provenance: Provenance
    validity: Validity = field(default_factory=Validity)

    def __post_init__(self) -> None:
        _coerce(self, scheme=Scheme, authority=Authority, provenance=Provenance, validity=Validity)
        object.__setattr__(self, "value", normalize_identifier(self.scheme, self.value))
        _require(subject_level(self.subject_id) is SCHEME_LEVEL[self.scheme],
                 f"assertion: {self.scheme} cannot identify a {subject_level(self.subject_id)}")

    @property
    def level(self) -> Level:
        return SCHEME_LEVEL[self.scheme]

    @property
    def tier(self) -> EvidenceTier:
        return AUTHORITY_TIER[self.authority]

    @property
    def evidence_id(self) -> str:
        return evidence_id({"kind": "assertion", "subject": self.subject_id, "scheme": self.scheme,
                            "value": self.value, "from": self.validity.valid_from,
                            "source": self.provenance.source, "record": self.provenance.source_record})


@dataclass(frozen=True, slots=True)
class Issuer:
    id: str
    name: str
    country: str | None = None
    status: SubjectStatus = SubjectStatus.ACTIVE

    def __post_init__(self) -> None:
        _coerce(self, status=SubjectStatus)
        _require(subject_level(self.id) is Level.ISSUER, "issuer: id must be an issuer id")
        _text(self.name, "issuer.name")
        _require(self.country is None or bool(COUNTRY.match(self.country)), "issuer.country: ISO 3166 alpha-2")


@dataclass(frozen=True, slots=True)
class Security:
    """A security, or a crypto asset (asset_class crypto, usually without issuer)."""

    id: str
    name: str
    asset_class: AssetClass
    kind: InstrumentKind
    issuer_id: str | None = None
    status: SubjectStatus = SubjectStatus.ACTIVE

    def __post_init__(self) -> None:
        _coerce(self, asset_class=AssetClass, kind=InstrumentKind, status=SubjectStatus)
        _require(subject_level(self.id) is Level.SECURITY, "security: id must be a security id")
        _require(self.issuer_id is None or subject_level(self.issuer_id) is Level.ISSUER,
                 "security.issuer_id: issuer id required")
        _text(self.name, "security.name")
        _require((self.asset_class is AssetClass.CRYPTO) == (self.kind in (InstrumentKind.COIN, InstrumentKind.TOKEN)),
                 "security: coin/token kinds belong to the crypto asset class and only there")


@dataclass(frozen=True, slots=True)
class Composite:
    """A country composite line (e.g. the US consolidated tape), not a venue."""

    id: str
    security_id: str
    country: str

    def __post_init__(self) -> None:
        _require(subject_level(self.id) is Level.COMPOSITE, "composite: id must be a composite id")
        _require(subject_level(self.security_id) is Level.SECURITY, "composite.security_id: security id required")
        _require(bool(COUNTRY.match(self.country)), "composite.country: ISO 3166 alpha-2")


@dataclass(frozen=True, slots=True)
class Listing:
    """A venue listing (ticker@MIC, currency) or a crypto deployment (CAIP-2 chain)."""

    id: str
    security_id: str
    ticker: str | None = None
    mic: str | None = None
    operating_mic: str | None = None
    chain: str | None = None
    currency: str | None = None
    composite_id: str | None = None
    primary: bool = False
    status: SubjectStatus = SubjectStatus.ACTIVE

    def __post_init__(self) -> None:
        _coerce(self, status=SubjectStatus)
        _require(subject_level(self.id) is Level.LISTING, "listing: id must be a listing id")
        _require(subject_level(self.security_id) is Level.SECURITY, "listing.security_id: security id required")
        _require(self.composite_id is None or subject_level(self.composite_id) is Level.COMPOSITE,
                 "listing.composite_id: composite id required")
        _require((self.mic is None) != (self.chain is None), "listing: exactly one of mic or chain")
        if self.mic is not None:
            _require(bool(MIC.match(self.mic)) and (self.operating_mic is None or bool(MIC.match(self.operating_mic))),
                     "listing: MICs are four upper-case characters")
            _require(bool(self.ticker and TICKER.match(self.ticker)), "listing.ticker: required at a venue")
            _require(bool(self.currency and CURRENCY.match(self.currency)), "listing.currency: ISO 4217 required at a venue")
        else:
            _require(bool(CAIP2.match(self.chain or "")), "listing.chain: CAIP-2 chain id required")
            _require(self.composite_id is None, "listing: deployments have no composite")

    @property
    def ticker_mic(self) -> str | None:
        """Join key: ticker at the operating MIC (segment MICs differ by source)."""
        mic = self.operating_mic or self.mic
        return f"{self.ticker}@{mic}" if mic and self.ticker else None


Subject = Issuer | Security | Composite | Listing


@dataclass(frozen=True, slots=True)
class Binding:
    """Provider ref -> subject at the ref's native level. Never a subject itself."""

    provider_ref: ProviderRef
    subject_id: str
    status: BindingStatus
    authority: Authority
    evidence_ids: tuple[str, ...]
    validity: Validity = field(default_factory=Validity)
    rule_id: str | None = None

    def __post_init__(self) -> None:
        _coerce(self, provider_ref=ProviderRef, status=BindingStatus, authority=Authority, validity=Validity)
        object.__setattr__(self, "evidence_ids", tuple(self.evidence_ids))
        subject_level(self.subject_id)
        _require(all(isinstance(item, str) and item.startswith("ev:") for item in self.evidence_ids),
                 "binding.evidence_ids: evidence ids required")
        if self.status is BindingStatus.CONFIRMED:
            _require(self.authority in CONFIRMING and bool(self.evidence_ids),
                     "binding: confirmation needs confirming authority and evidence")
        _require((self.authority is Authority.RULE_CONFIRMED) == (self.rule_id is not None),
                 "binding.rule_id: required exactly for rule confirmations")

    @property
    def level(self) -> Level:
        return subject_level(self.subject_id)

    @property
    def tier(self) -> EvidenceTier:
        return AUTHORITY_TIER[self.authority]


@dataclass(frozen=True, slots=True)
class Relation:
    """A typed edge between two distinct subjects. Relations never merge subjects."""

    type: RelationType
    from_id: str
    to_id: str
    authority: Authority
    provenance: Provenance
    validity: Validity = field(default_factory=Validity)
    ratio: str | None = None  # depositary_receipt_of: underlying shares per receipt

    def __post_init__(self) -> None:
        _coerce(self, type=RelationType, authority=Authority, provenance=Provenance, validity=Validity)
        _require(self.from_id != self.to_id, "relation: endpoints must be distinct subjects")
        check_relation(self.type, subject_level(self.from_id), subject_level(self.to_id), self.ratio)


def check_relation(type: RelationType, from_level: Level, to_level: Level, ratio: str | None) -> None:
    """Level and ratio rules shared by stored relations and relation claims."""
    expected = RELATION_LEVELS[type]
    _require((from_level, to_level) == expected if expected else from_level is to_level,
             f"relation: {type} links subjects at the wrong levels")
    _require(ratio is None or (type is RelationType.DEPOSITARY_RECEIPT_OF and bool(DECIMAL.match(ratio))),
             "relation.ratio: decimal, receipts only")
