"""Directory row (derived, flat, searchable) and the local search wire shapes.

The directory is rebuilt from the reference snapshot, reference-local, overlays
and identity v2. Search is one local read of it: no provider call, no identity
write, no reconciliation. Rows carry no prices.
"""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

RowKind = Literal["listing", "crypto_asset"]
RowTier = Literal["snapshot", "local", "overlay"]
MatchKind = Literal["identifier", "ticker", "provider_symbol", "name_prefix", "text"]
SEARCH_MAX_LIMIT = 40
GROUP_MAX_ROWS = 5


class ProviderRefWire(TypedDict):
    provider: str
    native_id: str
    native_scope: str
    qualifiers: NotRequired[dict[str, str]]


class DirectoryRow(TypedDict):
    """One row of `directory.sqlite3` `rows`.

    Listing rows are unique by (mic, ticker_root, ticker_class, currency) while
    active; crypto asset rows are keyed by the asset (security-level) subject.
    """

    row_id: str                    # the listing subject id, or the crypto asset subject id
    row_kind: RowKind
    security_id: str
    issuer_id: str | None
    composite_id: str | None
    group_key: str                 # issuer id, else security id
    mic: str | None
    operating_mic: str | None
    ticker_root: str               # crypto: the asset symbol
    ticker_class: str | None
    ticker_display: str
    currency: str | None
    price_scale: str
    name: str
    issuer_name: str | None
    kind: str                      # InstrumentKind value
    asset_class: str               # AssetClass value
    country: str | None
    venue_label: str | None
    isin: str | None
    lei: str | None
    cik: str | None
    figi: str | None
    share_class_figi: str | None
    composite_figi: str | None
    primary_listing: bool
    home_market: bool
    depositary_of: str | None      # underlying security id for receipts
    status: str                    # SubjectStatus value
    tier: RowTier
    provider_refs: list[ProviderRefWire]  # confirmed bindings only
    sources: list[str]             # plugins whose claims support the row
    aliases: list[str]
    rank_size: float | None        # combined size signal from plugin-contributed signals; None is unknown, not small
    rank_signals: dict[str, float]
    as_of: str                     # ISO date of the newest supporting source


class SearchRequest(TypedDict):
    query: str
    limit: NotRequired[int]                  # 1..SEARCH_MAX_LIMIT rows in total
    kinds: NotRequired[list[str]]            # InstrumentKind filter (the type pills)


class SearchTicker(TypedDict):
    root: str
    share_class: str | None
    display: str


class SearchVenue(TypedDict):
    mic: str
    operating_mic: str | None
    label: str | None
    country: str | None


class SearchRow(TypedDict):
    id: str                                  # row_id: a subject id, never a provider ref
    group: str
    primary: bool
    home_market: bool
    ticker: SearchTicker
    name: str
    issuer_name: str | None
    venue: SearchVenue | None                # None for crypto assets
    currency: str | None
    price_scale: str
    kind: str
    asset_class: str
    depositary_of: str | None
    tier: RowTier
    status: str
    identifiers: dict[str, str]              # display only: isin, figi, lei, cik where present locally
    providers: list[str]                     # plugins holding a confirmed binding (connector logos)
    match: MatchKind


class SearchGroup(TypedDict):
    key: str
    label: str
    rows: list[SearchRow]                    # at most GROUP_MAX_ROWS; primary line first
    more: int                                # further rows in this group, not returned


class LookupOffer(TypedDict):
    """An explicit, single-provider "Look up in X" action. Never run while typing."""

    plugin: str
    label: str


class DirectoryAsOf(TypedDict):
    snapshot_release: str | None
    overlays: dict[str, str]                 # plugin -> last complete sync instant


class SearchResponse(TypedDict):
    schema_version: Literal[1]
    query: str
    groups: list[SearchGroup]
    truncated: bool
    directory_as_of: DirectoryAsOf
    lookup: list[LookupOffer]                # enabled plugins with a declared resolve
