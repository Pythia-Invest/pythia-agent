"""Subject levels, global identifier schemes and their mechanical format checks.

Everything here is pure and standard-library only. Checksums are verified where
the scheme defines one; a valid format is never proof of identity by itself.
"""
from __future__ import annotations

import re
from enum import StrEnum


class Level(StrEnum):
    """The four backbone levels. Crypto assets sit at `security`, deployments at `listing`."""

    ISSUER = "issuer"
    SECURITY = "security"
    COMPOSITE = "composite"
    LISTING = "listing"


class Scheme(StrEnum):
    """Global identifier schemes. Provider symbols are bindings, never schemes."""

    LEI = "lei"
    CIK = "cik"
    ISIN = "isin"
    CUSIP = "cusip"
    SHARE_CLASS_FIGI = "share_class_figi"
    COMPOSITE_FIGI = "composite_figi"
    FIGI = "figi"
    TICKER_MIC = "ticker_mic"
    SEDOL = "sedol"
    CAIP19 = "caip19"


# Each scheme identifies exactly one level. An ISIN is never a listing key and an
# LEI never identifies a security; the stores enforce the same table in SQL.
SCHEME_LEVEL: dict[Scheme, Level] = {
    Scheme.LEI: Level.ISSUER,
    Scheme.CIK: Level.ISSUER,
    Scheme.ISIN: Level.SECURITY,
    Scheme.CUSIP: Level.SECURITY,
    Scheme.SHARE_CLASS_FIGI: Level.SECURITY,
    Scheme.COMPOSITE_FIGI: Level.COMPOSITE,
    Scheme.FIGI: Level.LISTING,
    Scheme.TICKER_MIC: Level.LISTING,
    Scheme.SEDOL: Level.LISTING,
    Scheme.CAIP19: Level.LISTING,
}

# Licensed numbering schemes default to device-local handling.
LICENSED_SCHEMES = frozenset({Scheme.CUSIP, Scheme.SEDOL})

SUBJECT_ID = re.compile(r"^(ref|local):(issuer|security|composite|listing):[A-Za-z0-9_-]{4,64}$")
MIC = re.compile(r"^[A-Z0-9]{4}$")
CURRENCY = re.compile(r"^[A-Z]{3}$")
COUNTRY = re.compile(r"^[A-Z]{2}$")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
INSTANT = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$")
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]+)?$")
NAMESPACE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
TICKER_ROOT = re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,15}$")
TICKER_CLASS = re.compile(r"^[A-Z0-9]{1,4}$")
CAIP2 = re.compile(r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$")

_PATTERNS = {
    Scheme.LEI: re.compile(r"^[A-Z0-9]{18}[0-9]{2}$"),
    Scheme.CIK: re.compile(r"^[0-9]{10}$"),
    Scheme.ISIN: re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$"),
    Scheme.CUSIP: re.compile(r"^[A-Z0-9]{8}[0-9]$"),
    Scheme.SHARE_CLASS_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]$"),
    Scheme.COMPOSITE_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]$"),
    Scheme.FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]$"),
    # ROOT[/CLASS]@MIC, e.g. ASML@XAMS or BRK/B@XNYS. Punctuation is the plugin's concern.
    Scheme.TICKER_MIC: re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,15}(/[A-Z0-9]{1,4})?@[A-Z0-9]{4}$"),
    Scheme.SEDOL: re.compile(r"^[B-DF-HJ-NP-TV-Z0-9]{6}[0-9]$"),
    # CAIP-19: chain_id "/" asset_namespace ":" asset_reference [ "/" token_id ]
    Scheme.CAIP19: re.compile(
        r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}(/[-.%a-zA-Z0-9]{1,78})?$"),
}


class IdentifierError(ValueError):
    """An identifier value is malformed for its scheme."""


def _value(character: str) -> int:
    return int(character) if character.isdigit() else ord(character) - 55


def _luhn_digits(digits: str) -> bool:
    total = 0
    for index, digit in enumerate(reversed(digits)):
        number = int(digit) * (2 if index % 2 == 1 else 1)
        total += number // 10 + number % 10
    return total % 10 == 0


def _alternating(value: str) -> int:
    """FIGI/CUSIP check digit: double every second character value, sum digits."""
    total = 0
    for index, character in enumerate(value[:-1]):
        number = _value(character) * (2 if index % 2 == 1 else 1)
        total += sum(int(digit) for digit in str(number))
    return (10 - total % 10) % 10


def _checksum(scheme: Scheme, value: str) -> bool:
    if scheme is Scheme.ISIN:
        return _luhn_digits("".join(str(_value(character)) for character in value))
    if scheme is Scheme.LEI:
        return int("".join(str(_value(character)) for character in value)) % 97 == 1
    if scheme in (Scheme.FIGI, Scheme.COMPOSITE_FIGI, Scheme.SHARE_CLASS_FIGI, Scheme.CUSIP):
        return _alternating(value) == int(value[-1])
    if scheme is Scheme.SEDOL:
        weights = (1, 3, 1, 7, 3, 9)
        total = sum(_value(character) * weight for character, weight in zip(value, weights))
        return (10 - total % 10) % 10 == int(value[-1])
    return True


def normalize_identifier(scheme: Scheme | str, value: str) -> str:
    """Return the canonical form of `value` or raise IdentifierError.

    CIKs are zero-padded to ten digits (SEC form); everything else is exact.
    """
    scheme = Scheme(scheme)
    if not isinstance(value, str) or not value or len(value) > 256:
        raise IdentifierError(f"{scheme}: value must be a non-empty string")
    if scheme is Scheme.CIK and value.isdigit() and len(value) <= 10:
        value = value.zfill(10)
    if not _PATTERNS[scheme].match(value):
        raise IdentifierError(f"{scheme}: malformed value")
    if scheme is Scheme.CIK and int(value) == 0:
        raise IdentifierError("cik: zero is not an identifier")
    if not _checksum(scheme, value):
        raise IdentifierError(f"{scheme}: check digit mismatch")
    return value


def ticker_mic(root: str, mic: str, share_class: str | None = None) -> str:
    """Canonical `ticker_mic` value from its parts."""
    value = f"{root}/{share_class}@{mic}" if share_class else f"{root}@{mic}"
    return normalize_identifier(Scheme.TICKER_MIC, value)


def subject_level(subject_id: str) -> Level:
    """The level encoded in an opaque subject ID (`ref:listing:…`, `local:issuer:…`)."""
    if not isinstance(subject_id, str) or not SUBJECT_ID.match(subject_id):
        raise IdentifierError("subject id: malformed")
    return Level(subject_id.split(":", 2)[1])
