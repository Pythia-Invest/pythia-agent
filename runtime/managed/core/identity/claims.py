"""Typed claims plugins return to the backbone (a resolve answer, a catalogue page) and their mechanical checks.

Plugins describe their own records; they never reconcile. A record or relation
claim names subjects by global identifiers or by the emitting plugin's own
declared native references, and a record may bind only those references.
Pythia subject IDs appear only in resolver verdicts on the core's queue (see
resolution.py), never in claims. Plugins never choose an evidence tier: the
core assigns it at ingest.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any, Mapping

from .manifest import Manifest
from .model import Provenance, ProviderRef, Validity, _coerce, _require, check_relation
from .schemes import (
    CAIP2, COUNTRY, CURRENCY, INSTRUMENT_KINDS, MIC, OPEN_KIND, SCHEME_LEVEL, SINGLE_VALUED, TICKER, Kind, Level,
    Scheme, normalize_identifier,
)
from .vocabulary import (
    AssetClass, IdentifierRole, InstrumentKind, RelationType, SubjectStatus,
)

MAX_BATCH_CLAIMS = 5000
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}\Z")
_DEPTH = {Level.ISSUER: 0, Level.SECURITY: 1, Level.COMPOSITE: 2, Level.LISTING: 3}


class BatchOrigin(StrEnum):
    CATALOGUE = "catalogue"  # a page of a bulk catalogue scope
    RESOLVE = "resolve"      # the answer to one resolve request
    # Open reference sources never emit: the reference builder writes the reference store itself.


@dataclass(frozen=True, slots=True)
class IdentifierValue:
    scheme: Scheme
    value: str
    role: IdentifierRole = IdentifierRole.SELF

    def __post_init__(self) -> None:
        _coerce(self, scheme=Scheme, role=IdentifierRole)
        object.__setattr__(self, "value", normalize_identifier(self.scheme, self.value))

    @property
    def level(self) -> Level | Kind:
        """The instrument level the scheme identifies, or the kind outside the hierarchy it keys (`OPEN_KIND`)."""
        return SCHEME_LEVEL[self.scheme] if self.scheme in SCHEME_LEVEL else OPEN_KIND[self.scheme]


@dataclass(frozen=True, slots=True)
class RecordAttributes:
    """Descriptive fields of a source record. None means the source did not say."""

    name: str | None = None
    issuer_name: str | None = None
    ticker: str | None = None
    mic: str | None = None
    operating_mic: str | None = None
    provider_venue: str | None = None  # the provider's own exchange code, kept for its MIC crosswalk
    venue_note: str | None = None  # why provider_venue names no operating MIC ("venue code XV is a trade report ..."); the plugin's own words
    currency: str | None = None
    country: str | None = None
    asset_class: AssetClass | None = None
    kind: InstrumentKind | None = None
    status: SubjectStatus | None = None
    aliases: tuple[str, ...] = ()
    rank: Mapping[str, float] = field(default_factory=dict)  # rank signals, e.g. {"market_cap_usd": 2.6e11}

    def __post_init__(self) -> None:
        _coerce(self, asset_class=AssetClass, kind=InstrumentKind, status=SubjectStatus)
        _require(isinstance(self.aliases, (list, tuple)), "record attributes: aliases are a list of names")
        object.__setattr__(self, "aliases", tuple(self.aliases))
        checks = ((self.ticker, TICKER), (self.mic, MIC), (self.operating_mic, MIC), (self.currency, CURRENCY),
                  (self.country, COUNTRY))
        _require(all(value is None or bool(pattern.match(value)) for value, pattern in checks),
                 "record attributes: malformed ticker, MIC, currency or country")
        _require(len(self.aliases) <= 32 and all(isinstance(name, str) and 0 < len(name) <= 512 for name in self.aliases),
                 "record attributes: aliases are at most 32 names of at most 512 characters")
        _require(all(isinstance(key, str) and isinstance(value, (int, float)) for key, value in self.rank.items()),
                 "record attributes: rank signals are numeric")


@dataclass(frozen=True, slots=True)
class Deployment:
    """A token deployment as the provider names it. Core maps the chain to CAIP-2 and derives CAIP-19."""

    chain: str               # the provider's own chain id, e.g. CoinGecko "ethereum", CoinMarketCap platform "1"
    contract: str            # contract address or mint, exactly as the provider gives it
    caip2: str | None = None # only when the plugin knows it, e.g. an EVM chain id -> eip155:<id>

    def __post_init__(self) -> None:
        _require(all(isinstance(text, str) and 0 < len(text) <= 128 for text in (self.chain, self.contract)),
                 "deployment: provider chain id and contract required")
        _require(self.caip2 is None or bool(CAIP2.match(self.caip2)), "deployment: malformed CAIP-2 chain id")


@dataclass(frozen=True, slots=True)
class RecordClaim:
    """One source record at its native level, with the identifiers it co-asserts.

    A crypto asset record (level security) may carry CAIP-19 deployments: at most
    one `self`, its canonical issuance and the only one that may key the asset,
    and any number `unqualified`, such as a provider's platform list. On the wire
    each of these states its role explicitly. The record may add its token
    deployments as the provider names them, and `native_of` (the provider chain id
    it is the native asset of) only where the provider states that as identity; a
    chain's fee or gas coin is not identity.

    A record of a kind outside the instrument hierarchy (a market, a protocol) is keyed by its native reference and
    carries no identifiers, but the one open identifier of its kind (`OPEN_KIND`: a market's `sui_object`, a protocol's
    `sui_package`), which keys the subject and which every source stating it joins.
    """

    level: Level | Kind
    identifiers: tuple[IdentifierValue, ...]
    provenance: Provenance
    attributes: RecordAttributes = field(default_factory=RecordAttributes)
    native_ref: ProviderRef | None = None
    validity: Validity = field(default_factory=Validity)
    deployments: tuple[Deployment, ...] = ()
    native_of: str | None = None

    def __post_init__(self) -> None:
        _coerce(self, provenance=Provenance, attributes=RecordAttributes, native_ref=ProviderRef, validity=Validity)
        object.__setattr__(self, "level", Level(self.level) if self.level in set(Level) else Kind(self.level))
        object.__setattr__(self, "identifiers", tuple(
            item if isinstance(item, IdentifierValue) else IdentifierValue(**item) for item in self.identifiers))
        object.__setattr__(self, "deployments", tuple(
            item if isinstance(item, Deployment) else Deployment(**item) for item in self.deployments))
        _require(bool(self.identifiers) or self.native_ref is not None, "record: identifiers or a native ref required")
        _require(self.level in INSTRUMENT_KINDS or (self.native_ref is not None and all(
                 item.scheme in OPEN_KIND and item.role is IdentifierRole.SELF for item in self.identifiers)),
                 f"record: a {self.level} record is keyed by its native ref and states only its own open identifier")
        _require(self.level is Level.SECURITY or not (self.deployments or self.native_of),
                 "record: only a crypto asset record carries deployments or native_of")
        _require(self.native_of is None or (isinstance(self.native_of, str) and 0 < len(self.native_of) <= 128),
                 "record: native_of is a provider chain id")
        for item in self.identifiers:
            # A record speaks for itself and its parents, never for narrower subjects,
            # except that a crypto asset record may list its CAIP-19 deployments.
            deployment = item.scheme is Scheme.CAIP19 and self.level is Level.SECURITY
            fits = item.level is self.level if item.scheme in OPEN_KIND else (
                self.level in _DEPTH and _DEPTH[item.level] <= _DEPTH[self.level])
            _require(fits or deployment, f"record: a {self.level} record cannot assert {item.scheme}")
        own = [item.scheme for item in self.identifiers
               if item.role is IdentifierRole.SELF and item.scheme in SINGLE_VALUED]
        _require(len(own) == len(set(own)), "record: one self value per single-valued scheme")


def _endpoint(value: Any) -> IdentifierValue | ProviderRef:
    """A relation end: a global identifier, or (on the wire, an object with `native_scope`) a native reference."""
    if isinstance(value, (IdentifierValue, ProviderRef)):
        return value
    if isinstance(value, Mapping):
        return ProviderRef(**value) if "native_scope" in value else IdentifierValue(**value)
    raise TypeError("relation claim: an endpoint is a global identifier or a native reference")


@dataclass(frozen=True, slots=True)
class RelationClaim:
    """A typed edge between subjects, each named by a global identifier or by the emitting plugin's own declared
    native reference (a pool's protocol, a market's asset). `check_batch` checks a native reference like a binding
    and the relation's kinds against the scopes its contract declares."""

    type: RelationType
    from_key: IdentifierValue | ProviderRef
    to_key: IdentifierValue | ProviderRef
    provenance: Provenance
    validity: Validity = field(default_factory=Validity)
    ratio: str | None = None
    role: str | None = None  # market_asset only: what the asset is to the market (vocabulary.MarketAssetRole)

    def __post_init__(self) -> None:
        _coerce(self, type=RelationType, provenance=Provenance, validity=Validity)
        object.__setattr__(self, "from_key", _endpoint(self.from_key))
        object.__setattr__(self, "to_key", _endpoint(self.to_key))
        _require(self.from_key != self.to_key, "relation claim: endpoints must differ")
        if isinstance(self.from_key, IdentifierValue) and isinstance(self.to_key, IdentifierValue):
            check_relation(self.type, self.from_key.level, self.to_key.level, self.ratio, self.role)


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


class ClaimError(ValueError):
    pass


def _fail(index: int | None, reason: str) -> ClaimError:
    return ClaimError(f"claims[{index}]: {reason}" if index is not None else f"batch: {reason}")


def check_batch(batch: ClaimBatch, manifest: Manifest) -> None:
    """Mechanical contract checks for a batch against its plugin's validated manifest."""
    if (batch.plugin, batch.provider) != (manifest.plugin, manifest.provider):
        raise _fail(None, "plugin or provider differs from the manifest")
    if batch.origin is BatchOrigin.CATALOGUE and batch.scope not in manifest.catalogue_scopes:
        raise _fail(None, "no declared bulk catalogue scope")
    if batch.origin is BatchOrigin.RESOLVE and manifest.resolve is None:
        raise _fail(None, "no declared resolve")
    seen: set[tuple[str, str]] = set()
    for index, claim in enumerate(batch.claims):
        provenance = claim.provenance
        if provenance.plugin != batch.plugin or provenance.adapter_version != batch.adapter_version:
            raise _fail(index, "provenance does not name this plugin and adapter version")
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
        if isinstance(claim, RelationClaim) and ProviderRef in (type(claim.from_key), type(claim.to_key)):
            starts, ends = (_kinds(end, manifest, index) for end in (claim.from_key, claim.to_key))
            if not any(_links(claim, start, end) for start in starts for end in ends):
                raise _fail(index, f"{claim.type} cannot link these subjects")


def _kinds(end: IdentifierValue | ProviderRef, manifest: Manifest, index: int) -> set[str]:
    """The kinds a relation end may name: an identifier's level, or each kind its plugin declares the scope at."""
    if isinstance(end, IdentifierValue):
        return {end.level}
    if end.provider != manifest.provider or manifest.native_scope(end.native_scope) is None:
        raise _fail(index, "a plugin names only its own declared native references")
    return {scope.level for scope in manifest.native if scope.native_scope == end.native_scope}


def _links(claim: RelationClaim, start: str, end: str) -> bool:
    try:
        check_relation(claim.type, start, end, claim.ratio, claim.role)
    except ValueError:
        return False
    return True


def batch_to_json(batch: ClaimBatch) -> dict[str, Any]:
    """The wire form of a batch: plain JSON values with the dataclass field names.

    A relation claim is told apart from a record claim by its `from_key`.
    """
    return json.loads(json.dumps(asdict(batch)))


def batch_from_json(document: Mapping[str, Any] | str) -> ClaimBatch:
    """Parse and validate a wire batch; raise ClaimError naming what is wrong."""
    try:
        body = json.loads(document) if isinstance(document, str) else document
        if not isinstance(body, Mapping) or not isinstance(body.get("claims"), list):
            raise ValueError("object with a claims list required")
        claims = []
        for index, item in enumerate(body["claims"]):
            try:
                if not isinstance(item, Mapping):
                    raise ValueError("object required")
                if item.get("level") == "security" and any(
                        isinstance(value, Mapping) and value.get("scheme") == "caip19" and "role" not in value
                        for value in item.get("identifiers") or ()):
                    # `self` is the default role, and on an asset record it claims canonical issuance: never implied.
                    raise ValueError("record: a crypto asset record states each CAIP-19's role")
                claims.append(RelationClaim(**item) if "from_key" in item else RecordClaim(**item))
            except (TypeError, ValueError) as error:
                raise _fail(index, str(error)) from None
        return ClaimBatch(**{**body, "claims": tuple(claims)})
    except ClaimError:
        raise
    except (TypeError, ValueError) as error:
        raise _fail(None, str(error)) from None
