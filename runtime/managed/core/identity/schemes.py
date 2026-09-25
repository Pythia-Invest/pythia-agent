"""Subject levels, global identifier schemes and their mechanical format checks.

Everything here is pure and standard-library only. Checksums are verified where
the scheme defines one; a valid format is never proof of identity by itself.
"""
from __future__ import annotations

import hashlib
import re
from enum import StrEnum
from typing import Mapping


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
    SHARE_CLASS_FIGI = "share_class_figi"
    COMPOSITE_FIGI = "composite_figi"
    FIGI = "figi"
    TICKER_MIC = "ticker_mic"
    CAIP19 = "caip19"


# Each scheme identifies exactly one level. An ISIN is never a listing key and an
# LEI never identifies a security; the stores enforce the same table in SQL.
SCHEME_LEVEL: dict[Scheme, Level] = {
    Scheme.LEI: Level.ISSUER,
    Scheme.CIK: Level.ISSUER,
    Scheme.ISIN: Level.SECURITY,
    Scheme.SHARE_CLASS_FIGI: Level.SECURITY,
    Scheme.COMPOSITE_FIGI: Level.COMPOSITE,
    Scheme.FIGI: Level.LISTING,
    Scheme.TICKER_MIC: Level.LISTING,
    Scheme.CAIP19: Level.LISTING,
}

# Schemes with one current value per subject: two different values valid at the same
# time contradict each other. A ticker is an attribute (reused, renamed) and never does.
SINGLE_VALUED = frozenset(Scheme) - {Scheme.TICKER_MIC}

# <level>:<key scheme>:<key>, derived from open identifiers (see subject_id below).
SUBJECT_ID = re.compile(
    r"^(issuer|security|composite|listing):(lei|cik|isin|figi|caip19|provisional):[A-Za-z0-9._:/%-]{4,300}\Z")
MIC = re.compile(r"^[A-Z0-9]{4}\Z")
CURRENCY = re.compile(r"^[A-Z]{3}\Z")
COUNTRY = re.compile(r"^[A-Z]{2}\Z")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
INSTANT = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})\Z")
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]+)?\Z")
NAMESPACE = re.compile(r"^[a-z][a-z0-9_-]{0,63}\Z")
TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,15}\Z")
CAIP2 = re.compile(r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\Z")
PROVISIONAL_NATIVE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\Z")

_PATTERNS = {
    Scheme.LEI: re.compile(r"^[A-Z0-9]{18}[0-9]{2}\Z"),
    Scheme.CIK: re.compile(r"^[0-9]{10}\Z"),
    Scheme.ISIN: re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]\Z"),
    Scheme.SHARE_CLASS_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    Scheme.COMPOSITE_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    Scheme.FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    # TICKER@MIC, e.g. ASML@XAMS.
    Scheme.TICKER_MIC: re.compile(r"^[A-Z0-9][A-Z0-9.&-]{0,15}@[A-Z0-9]{4}\Z"),
    # CAIP-19: chain_id "/" asset_namespace ":" asset_reference [ "/" token_id ]
    Scheme.CAIP19: re.compile(
        r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}(/[-.%a-zA-Z0-9]{1,78})?\Z"),
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
    """FIGI check digit: double every second character value, sum digits."""
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
    if scheme in (Scheme.FIGI, Scheme.COMPOSITE_FIGI, Scheme.SHARE_CLASS_FIGI):
        return _alternating(value) == int(value[-1])
    return True


def normalize_identifier(scheme: Scheme | str, value: str) -> str:
    """Return the canonical form of `value` or raise IdentifierError.

    CIKs are zero-padded to ten digits (SEC form). EVM (eip155) asset references
    are hex addresses and are lower-cased, so a checksummed and a plain address
    name one token; other chains' references are case-sensitive and kept exact.
    """
    scheme = Scheme(scheme)
    if not isinstance(value, str) or not value or len(value) > 256:
        raise IdentifierError(f"{scheme}: value must be a non-empty string")
    if scheme is Scheme.CIK and value.isdigit() and len(value) <= 10:
        value = value.zfill(10)
    if scheme is Scheme.CAIP19 and value.startswith("eip155:"):
        value = value.lower()
    if not _PATTERNS[scheme].match(value):
        raise IdentifierError(f"{scheme}: malformed value")
    if scheme is Scheme.CIK and int(value) == 0:
        raise IdentifierError("cik: zero is not an identifier")
    if not _checksum(scheme, value):
        raise IdentifierError(f"{scheme}: check digit mismatch")
    return value


def ticker_mic(ticker: str, mic: str) -> str:
    """Canonical `ticker_mic` value from its parts."""
    return normalize_identifier(Scheme.TICKER_MIC, f"{ticker}@{mic}")


def subject_level(subject_id: str) -> Level:
    """The level a subject ID names (`listing:isin:NL0010273215:XAMS:EUR` is a listing)."""
    if not isinstance(subject_id, str) or not SUBJECT_ID.match(subject_id):
        raise IdentifierError("subject id: malformed")
    return Level(subject_id.split(":", 1)[0])


def subject_id(level: Level | str, identifiers: Mapping[Scheme | str, str], *, operating_mic: str | None = None,
               currency: str | None = None, country: str | None = None) -> str | None:
    """Derive the deterministic subject ID from open identifiers, or None if none applies.

    Every install and every rebuild derives the same ID from the same open
    evidence. Precedence per level:
      issuer     lei, else cik
      security   isin, else share_class_figi, else caip19 (a crypto asset's home deployment)
      composite  the security key + country
      listing    isin + operating MIC + currency, else figi, else caip19 (a chain deployment)
    Tickers are attributes, not keys, so a ticker change keeps the ID.
    """
    level = Level(level)
    known = {Scheme(scheme): normalize_identifier(scheme, value) for scheme, value in identifiers.items() if value}

    def security_key() -> str | None:
        for scheme, tag in ((Scheme.ISIN, "isin"), (Scheme.SHARE_CLASS_FIGI, "figi"), (Scheme.CAIP19, "caip19")):
            if scheme in known:
                return f"{tag}:{known[scheme]}"
        return None

    if level is Level.ISSUER:
        key = f"lei:{known[Scheme.LEI]}" if Scheme.LEI in known else (
            f"cik:{known[Scheme.CIK]}" if Scheme.CIK in known else None)
    elif level is Level.SECURITY:
        key = security_key()
    elif level is Level.COMPOSITE:
        base = security_key()
        key = f"{base}:{country}" if base and not base.startswith("caip19:") and country and COUNTRY.match(country) else None
    elif Scheme.ISIN in known and operating_mic and currency and MIC.match(operating_mic) and CURRENCY.match(currency):
        key = f"isin:{known[Scheme.ISIN]}:{operating_mic}:{currency}"
    elif Scheme.FIGI in known:
        key = f"figi:{known[Scheme.FIGI]}"
    else:
        key = f"caip19:{known[Scheme.CAIP19]}" if Scheme.CAIP19 in known else None
    return f"{level}:{key}" if key else None


def provisional_id(level: Level | str, provider: str, native_scope: str, native_id: str) -> str:
    """Provider-namespaced ID for a subject no open identifier names (a provider-only index, an
    unmapped coin, a private company). Valid and deterministic per provider reference, but not
    portable across provider sets; it becomes an alias once an open identifier names the subject.
    """
    if not NAMESPACE.match(provider) or not NAMESPACE.match(native_scope):
        raise IdentifierError("provisional id: provider and native_scope must be namespaces")
    readable = PROVISIONAL_NATIVE.match(native_id)
    key = native_id if readable else "sha256-" + hashlib.sha256(native_id.encode()).hexdigest()[:32]
    return f"{Level(level)}:provisional:{provider}:{native_scope}:{key}"
