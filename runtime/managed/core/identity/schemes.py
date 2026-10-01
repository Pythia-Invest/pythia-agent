"""Subject kinds and levels, global identifier schemes and their mechanical format checks.

Everything here is pure and standard-library only. Checksums are verified where
the scheme defines one; a valid format is never proof of identity by itself.
"""
from __future__ import annotations

import hashlib
import re
import string
from enum import StrEnum
from typing import Mapping
from urllib.parse import unquote


class Level(StrEnum):
    """The four instrument levels, issuer -> security -> composite -> listing. Crypto assets sit at `security`,
    deployments at `listing`. Level walks and `via` apply only within this hierarchy."""

    ISSUER = "issuer"
    SECURITY = "security"
    COMPOSITE = "composite"
    LISTING = "listing"


class Kind(StrEnum):
    """Registered subject kinds: the first segment of a subject ID. The instrument kinds are the four levels;
    the others sit outside that hierarchy, have no parent and connect to other subjects only by typed relations.
    Readers pass an unregistered kind through as an opaque string; stores accept only registered kinds."""

    ISSUER = "issuer"
    SECURITY = "security"
    COMPOSITE = "composite"
    LISTING = "listing"
    CURRENCY = "currency"  # an ISO 4217 currency
    FX = "fx"              # a currency pair
    SERIES = "series"      # a non-tradable data series (a policy rate, a yield curve point)
    INDEX = "index"        # an index level (never a security: it cannot be held)
    PROTOCOL = "protocol"  # a DeFi protocol (no legal-entity identifier)
    MARKET = "market"      # a lending reserve, pool, vault, perp or continuous front-month futures market


INSTRUMENT_KINDS = frozenset(Level)
# The key schemes (an ID's second segment) each kind may use: `subject_id` derives the instrument keys; a kind
# outside the hierarchy takes a Pythia-curated (`pythia`) or provisional key until its open schemes are registered
# with its first data. `cgs_isin` is the device-local key of a CGS-area ISIN (see KEY_RULE).
_OTHER_KEYS = frozenset({"pythia", "provisional"})
KEY_SCHEMES: dict[Kind, frozenset[str]] = {
    Kind.ISSUER: frozenset({"lei", "cik", "provisional"}),
    Kind.SECURITY: frozenset({"isin", "figi", "caip19", "cgs_isin", "provisional"}),
    Kind.COMPOSITE: frozenset({"isin", "figi", "provisional"}),
    Kind.LISTING: frozenset({"isin", "figi", "caip19", "cgs_isin", "provisional"}),
    **{kind: _OTHER_KEYS for kind in Kind if kind not in INSTRUMENT_KINDS},
    # Experiment (docs/architecture/identity-data.md, "Sui identifiers"): open keys for Sui DeFi subjects.
    Kind.PROTOCOL: _OTHER_KEYS | {"sui_package"},
    Kind.MARKET: _OTHER_KEYS | {"sui_object"},
}


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
    # Open identifiers of a kind outside the instrument hierarchy (OPEN_KIND): the subject's own key.
    SUI_PACKAGE = "sui_package"  # a Sui protocol's original package ID
    SUI_OBJECT = "sui_object"    # a Sui object ID: a pool, reserve, order book or vault


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

# The schemes that key a kind outside the hierarchy. They have no instrument level: a record of that kind states them
# for itself, and the subject they name is `<kind>:<scheme>:<value>`.
OPEN_KIND: dict[Scheme, Kind] = {Scheme.SUI_PACKAGE: Kind.PROTOCOL, Scheme.SUI_OBJECT: Kind.MARKET}

# Schemes with one current value per subject: two different values valid at the same
# time contradict each other. A ticker is an attribute (reused, renamed) and never does.
SINGLE_VALUED = frozenset(Scheme) - {Scheme.TICKER_MIC}

# What a person calls each scheme: Repairs titles and questions use these words, and Desk shows them as they are.
SCHEME_LABEL: dict[Scheme, str] = {
    Scheme.LEI: "LEI", Scheme.CIK: "CIK", Scheme.ISIN: "ISIN", Scheme.SHARE_CLASS_FIGI: "Share-class FIGI",
    Scheme.COMPOSITE_FIGI: "Composite FIGI", Scheme.FIGI: "FIGI", Scheme.TICKER_MIC: "Ticker", Scheme.CAIP19: "CAIP-19",
    Scheme.SUI_PACKAGE: "Sui package", Scheme.SUI_OBJECT: "Sui object",
}


def scheme_label(scheme: str | None) -> str:
    """A scheme's name for a person. A scheme core does not know (a store a later version wrote) shows as its own
    name with the underscores spelled out."""
    name = scheme or ""
    return SCHEME_LABEL.get(name) or name.replace("_", " ")

# <kind>:<key scheme>:<key>, derived from open identifiers (see subject_id below). The format is open: kinds and
# key schemes grow without changing it.
SUBJECT_ID = re.compile(r"^[a-z][a-z0-9_]{0,31}:[a-z][a-z0-9_]{0,31}:[A-Za-z0-9._:/%-]{1,300}\Z")
MIC = re.compile(r"^[A-Z0-9]{4}\Z")
CURRENCY = re.compile(r"^[A-Z]{3}\Z")
COUNTRY = re.compile(r"^[A-Z]{2}\Z")
DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z")
INSTANT = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})\Z")
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]+)?\Z")
NAMESPACE = re.compile(r"^[a-z][a-z0-9_-]{0,63}\Z")
# A venue ticker; one space may separate a one-letter share class as the venue writes it (`VOLV B` on Nasdaq
# Stockholm). A two-letter suffix is refused: `AAPL US` or `ASML NA` is a Bloomberg code, not a venue ticker.
TICKER_BODY = r"[A-Z0-9][A-Z0-9.&-]{0,15}(?: [A-Z])?"
TICKER = re.compile(rf"^{TICKER_BODY}\Z")
CAIP2 = re.compile(r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\Z")
PROVISIONAL_NATIVE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}\Z")

_PATTERNS = {
    Scheme.LEI: re.compile(r"^[A-Z0-9]{18}[0-9]{2}\Z"),
    Scheme.CIK: re.compile(r"^[0-9]{10}\Z"),
    Scheme.ISIN: re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]\Z"),
    Scheme.SHARE_CLASS_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    Scheme.COMPOSITE_FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    Scheme.FIGI: re.compile(r"^BBG[B-DF-HJ-NP-TV-Z0-9]{8}[0-9]\Z"),
    # TICKER@operating MIC, e.g. ASML@XAMS, ASML@XNAS (never a segment MIC such as XNGS).
    Scheme.TICKER_MIC: re.compile(rf"^{TICKER_BODY}@[A-Z0-9]{{4}}\Z"),
    # CAIP-19: chain_id "/" asset_namespace ":" asset_reference [ "/" token_id ]
    Scheme.CAIP19: re.compile(
        r"^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}(/[-.%a-zA-Z0-9]{1,78})?\Z"),
    # A Sui object or package ID in canonical form: 0x and 64 lowercase hex digits (`normalize_identifier` pads and lowers).
    Scheme.SUI_PACKAGE: re.compile(r"^0x[0-9a-f]{64}\Z"),
    Scheme.SUI_OBJECT: re.compile(r"^0x[0-9a-f]{64}\Z"),
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


# The Pythia-local Sui profile (ADR 0037): `sui:<chain>/coin:<coin type>`, and native SUI as `slip44:784`. A generic
# coin type is refused: with a struct argument it always exceeds CAIP-19's 128 characters, so it stays provisional.
_SUI_COIN = re.compile(r"^0x([0-9a-fA-F]{1,64})(::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*)\Z")
_SUI_NATIVE = f"0x{'2':0>64}::sui::SUI"
_CAIP19_REFERENCE = frozenset("-." + string.ascii_letters + string.digits)  # plus `%`, the escape itself


def _sui(value: str) -> str:
    """A `sui:` CAIP-19 in the Pythia-local profile. A coin type's address takes lowercase 64-hex long form, and every
    character outside CAIP-19's reference set is percent-encoded in uppercase hex (a Move `_` as well as `::`).
    Encoded input is decoded first, so the form is stable."""
    chain, _, asset = value.partition("/")
    namespace, _, reference = asset.partition(":")
    if (namespace, reference) == ("slip44", "784"):
        return value
    match = _SUI_COIN.match(unquote(reference)) if namespace == "coin" else None
    if match is None:
        raise IdentifierError("caip19: a sui asset is slip44:784 or a non-generic coin type")
    coin = f"0x{match[1].lower():0>64}{match[2]}"
    if coin == _SUI_NATIVE:
        return f"{chain}/slip44:784"
    encoded = "".join(char if char in _CAIP19_REFERENCE else f"%{ord(char):02X}" for char in coin)
    if len(encoded) > 128:
        raise IdentifierError("caip19: a sui coin type over 128 characters has no CAIP-19 key")
    return f"{chain}/coin:{encoded}"


def normalize_identifier(scheme: Scheme | str, value: str) -> str:
    """Return the canonical form of `value` or raise IdentifierError.

    CIKs are zero-padded to ten digits (SEC form). A Sui package or object ID is lower-cased and padded to 64 hex digits.
    EVM (eip155) asset references
    are hex addresses and are lower-cased, so a checksummed and a plain address
    name one token. Sui references follow the Pythia-local profile (`_sui`): a raw
    coin type such as `sui:mainnet/coin:0x2::sui::SUI` is accepted and canonicalised,
    and a generic one or one whose reference exceeds CAIP-19's 128 characters is
    refused, so it keeps a provisional ID. Other chains' references are
    case-sensitive and kept exact.
    """
    scheme = Scheme(scheme)
    if not isinstance(value, str) or not value or len(value) > 256:
        raise IdentifierError(f"{scheme}: value must be a non-empty string")
    if scheme is Scheme.CIK and value.isdigit() and len(value) <= 10:
        value = value.zfill(10)
    if scheme is Scheme.CAIP19 and value.startswith("eip155:"):
        value = value.lower()
    if scheme is Scheme.CAIP19 and value.startswith("sui:"):
        value = _sui(value)
    if scheme in OPEN_KIND:  # a Sui address: short forms are padded, hex is lower-cased
        head, digits = value[:2].lower(), value[2:]
        if head == "0x" and 0 < len(digits) <= 64 and all(char in string.hexdigits for char in digits):
            value = f"0x{digits.lower():0>64}"
    if not _PATTERNS[scheme].match(value):
        raise IdentifierError(f"{scheme}: malformed value")
    if scheme is Scheme.CIK and int(value) == 0:
        raise IdentifierError("cik: zero is not an identifier")
    if not _checksum(scheme, value):
        raise IdentifierError(f"{scheme}: check digit mismatch")
    return value


def sui_caip19(coin_type: str) -> str | None:
    """A Sui mainnet coin type as the CAIP-19 key core joins on, or None when core gives it none: a generic type, or
    one whose key would pass CAIP-19's 128 characters. The plugins that state Sui coins share this one reading."""
    try:
        return normalize_identifier(Scheme.CAIP19, f"sui:mainnet/coin:{coin_type}")
    except IdentifierError:
        return None


def ticker_mic(ticker: str, mic: str) -> str:
    """Canonical `ticker_mic` value; `mic` is the operating MIC."""
    return normalize_identifier(Scheme.TICKER_MIC, f"{ticker}@{mic}")


def subject_kind(subject_id: str) -> str:
    """The kind a well-formed subject ID names, as text: registered or not, it is passed through."""
    if not isinstance(subject_id, str) or not SUBJECT_ID.match(subject_id):
        raise IdentifierError("subject id: malformed")
    return subject_id.split(":", 1)[0]


def registered_kind(subject_id: str) -> Kind:
    """The kind of a subject ID whose kind and key scheme are both registered (KEY_SCHEMES); raises otherwise.
    Writers and the instrument code check this; readers only need `subject_kind`."""
    kind, scheme = subject_kind(subject_id), subject_id.split(":", 2)[1]
    if kind not in KEY_SCHEMES:
        raise IdentifierError(f"subject id: {kind} is not a registered kind")
    if scheme not in KEY_SCHEMES[Kind(kind)]:
        raise IdentifierError(f"subject id: a {kind} is not keyed by {scheme}")
    return Kind(kind)


def subject_level(subject_id: str) -> Level:
    """The instrument level a subject ID names (`listing:isin:NL0010273215:XAMS:EUR` is a listing); raises for a
    subject outside the instrument hierarchy or an unregistered key scheme."""
    kind = registered_kind(subject_id)
    if kind not in INSTRUMENT_KINDS:
        raise IdentifierError(f"subject id: a {kind} is not an instrument")
    return Level(kind)



# The subject-key rule (ADR 0037), versioned: a new rule is a new version, recorded in the
# reference `release` table, with aliases from the old IDs. Portable keys use only identifiers every
# build path has and may host. ISINs from CUSIP Global Services (US and Canadian ISINs, and those of
# the territories and offshore centres whose ISINs carry a CUSIP/CINS number) are licensed, local-only
# evidence, so they never key a portable subject: such securities are keyed by share-class FIGI and
# keep the ISIN as an assertion. Until a FIGI is known, the ISIN keys a device-local subject
# (`cgs_isin`, last in precedence), the same from every source; `subject_key@2` added it.
KEY_RULE = "subject_key@2"
CGS_AREA = frozenset((
    "US", "CA",  # CGS is the national numbering agency
    "AS", "GU", "MP", "PR", "VI", "UM",  # US territories
    "BM", "KY", "VG", "AI", "AG", "BS", "BB", "BZ", "TC", "MH", "FM", "PW",  # CGS as substitute agency
))


def subject_id(level: Level | str, identifiers: Mapping[Scheme | str, str], *, operating_mic: str | None = None,
               currency: str | None = None, country: str | None = None) -> str | None:
    """Derive the deterministic subject ID from open identifiers, or None if none applies.

    Every install and every rebuild derives the same ID from the same open
    evidence. Precedence per level (KEY_RULE; "isin" means an ISIN outside CGS_AREA, "cgs_isin" one inside):
      issuer     lei, else cik
      security   isin, else share_class_figi, else caip19 (a crypto asset's canonical issuance deployment),
                 else cgs_isin (device-local)
      composite  the security key + country (none for a caip19 or cgs_isin security)
      listing    isin + operating MIC + currency, else figi, else caip19 (a chain deployment),
                 else cgs_isin + operating MIC + currency (device-local)
    Tickers are attributes, not keys, so a ticker change keeps the ID.
    Collisions: venue lines with the same ISIN, operating MIC and currency are
    one listing; their segment MICs and tickers are attributes (ticker_mic is
    multi-valued). The builder derives from all open evidence for a record, so
    the ID never depends on build order; when a higher-precedence identifier
    appears later, the old ID is re-keyed through reference id_aliases.
    """
    level = Level(level)
    known = {Scheme(scheme): normalize_identifier(scheme, value) for scheme, value in identifiers.items() if value}
    cgs = known.pop(Scheme.ISIN) if known.get(Scheme.ISIN, "")[:2] in CGS_AREA else None  # never a portable key
    venue = bool(operating_mic and currency and MIC.match(operating_mic) and CURRENCY.match(currency))

    def security_key() -> str | None:
        for scheme, tag in ((Scheme.ISIN, "isin"), (Scheme.SHARE_CLASS_FIGI, "figi"), (Scheme.CAIP19, "caip19")):
            if scheme in known:
                return f"{tag}:{known[scheme]}"
        return None

    if level is Level.ISSUER:
        key = f"lei:{known[Scheme.LEI]}" if Scheme.LEI in known else (
            f"cik:{known[Scheme.CIK]}" if Scheme.CIK in known else None)
    elif level is Level.SECURITY:
        key = security_key() or (f"cgs_isin:{cgs}" if cgs else None)
    elif level is Level.COMPOSITE:
        base = security_key()
        key = f"{base}:{country}" if base and not base.startswith("caip19:") and country and COUNTRY.match(country) else None
    elif Scheme.ISIN in known and venue:
        key = f"isin:{known[Scheme.ISIN]}:{operating_mic}:{currency}"
    elif Scheme.FIGI in known:
        key = f"figi:{known[Scheme.FIGI]}"
    elif Scheme.CAIP19 in known:
        key = f"caip19:{known[Scheme.CAIP19]}"
    else:
        key = f"cgs_isin:{cgs}:{operating_mic}:{currency}" if cgs and venue else None
    return f"{level}:{key}" if key else None


def provisional_id(kind: Kind | str, provider: str, native_scope: str, native_id: str) -> str:
    """Provider-namespaced ID for a subject no open identifier names (a provider-only index, an
    unmapped coin, a private company), of a registered kind: an index is `index:provisional:…`, never a
    security. Valid and deterministic per provider reference, but not portable across provider sets; it
    becomes an alias once an open identifier names the subject.
    """
    if not NAMESPACE.match(provider) or not NAMESPACE.match(native_scope):
        raise IdentifierError("provisional id: provider and native_scope must be namespaces")
    readable = PROVISIONAL_NATIVE.match(native_id)
    key = native_id if readable else "sha256-" + hashlib.sha256(native_id.encode()).hexdigest()[:32]
    return f"{Kind(kind)}:provisional:{provider}:{native_scope}:{key}"


# Core's curated canonical-asset table (canonical_assets.json, ADR 0037 Crypto): Pythia's maintained default supplier
# of canonical-issuance claims, the one claim type that keys a crypto asset.
CANONICAL_ASSETS_RULE = "canonical_assets@1"

