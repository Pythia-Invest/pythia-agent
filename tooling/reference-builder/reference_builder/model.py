"""In-memory records: parsed source rows and the assembled four-level snapshot.

Source parsers produce the first group; `assemble` turns them into issuers,
securities and listings. Only `schema.py` knows how these map onto tables.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# ---- parsed source rows -------------------------------------------------------


@dataclass(frozen=True)
class Venue:
    mic: str
    operating_mic: str
    level: str  # OPRT or SGMT
    name: str
    country: str
    category: str | None
    status: str


@dataclass(frozen=True)
class FirdsRecord:
    """One FIRDS reference-data record: an ISIN admitted to one trading venue."""

    kind: str  # full | new | modified | terminated | cancelled
    isin: str
    mic: str
    cfi: str
    full_name: str | None
    short_name: str | None
    currency: str | None
    issuer_lei: str | None
    relevant_mic: str | None
    first_trade: str | None
    termination: str | None
    underlying_isin: str | None = None


@dataclass(frozen=True)
class Transparency:
    """ESMA FITRS equity transparency result for one ISIN."""

    isin: str
    classification: str | None
    turnover_eur: float | None
    transactions: float | None
    methodology: str | None
    applies_from: str | None
    applies_to: str | None
    relevant_mic: str | None


@dataclass(frozen=True)
class GleifEntity:
    lei: str
    legal_name: str
    legal_language: str | None
    names: tuple[tuple[str, str, str | None], ...]  # (name, GLEIF type, language)
    jurisdiction: str | None
    country: str | None
    entity_status: str | None
    registration_status: str | None
    registered_at: str | None
    registered_as: str | None
    successor_lei: str | None


@dataclass(frozen=True)
class SecTicker:
    cik: str
    name: str
    ticker: str
    exchange: str | None
    position: int  # order in the SEC file


# ---- assembled snapshot ------------------------------------------------------


@dataclass
class Issuer:
    issuer_id: str
    name: str
    source: str
    lei: str | None = None
    cik: str | None = None
    legal_name: str | None = None
    name_rule: str | None = None
    jurisdiction: str | None = None
    country: str | None = None
    entity_status: str | None = None
    registration_status: str | None = None
    cik_rule: str | None = None
    names: list[tuple[str, str, str | None, str]] = field(default_factory=list)


@dataclass
class Security:
    security_id: str
    kind: str  # share | dr | preferred | fund | other
    source: str
    issuer_id: str | None = None
    isin: str | None = None
    share_class_figi: str | None = None
    cfi: str | None = None
    fisn: str | None = None
    name: str | None = None
    currency: str | None = None
    primary_mic: str | None = None
    primary_rule: str | None = None
    activity: str = "active"
    turnover_eur: float | None = None
    turnover_method: str | None = None
    rank: int | None = None  # notability order within its source, 1 = most notable (see pipeline.rank)


@dataclass
class Listing:
    listing_id: str
    source: str
    row_class: str
    security_id: str | None = None
    issuer_id: str | None = None
    mic: str | None = None
    operating_mic: str | None = None
    country: str | None = None
    ticker: str | None = None
    ticker_root: str | None = None
    ticker_class: str | None = None
    ticker_source: str | None = None
    currency: str | None = None
    figi: str | None = None
    composite_figi: str | None = None
    share_class_figi: str | None = None
    security_type: str | None = None
    name: str | None = None
    is_primary: bool = False
    status: str = "active"  # active | suspect | inactive
    status_reasons: list[str] = field(default_factory=list)
    valid_from: str | None = None
    valid_to: str | None = None
    position: int | None = None  # SEC lines: order in the SEC file


@dataclass(frozen=True)
class Relationship:
    from_id: str
    relation: str
    to_id: str
    source: str
    rule_id: str


@dataclass(frozen=True)
class Flag:
    subject_id: str
    flag: str
    detail: str | None = None


@dataclass
class Snapshot:
    as_of: str
    venues: dict[str, Venue] = field(default_factory=dict)
    issuers: dict[str, Issuer] = field(default_factory=dict)
    securities: dict[str, Security] = field(default_factory=dict)
    listings: dict[str, Listing] = field(default_factory=dict)
    relationships: list[Relationship] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)
    audit: dict = field(default_factory=dict)

    def flag(self, subject_id: str, flag: str, detail: str | None = None) -> None:
        self.flags.append(Flag(subject_id, flag, detail))
