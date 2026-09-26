"""Deterministic audit rules (see the quality audit behind the identity backbone).

Every rule is a pure function so it can be tested on hand-made rows. Each
returns the decision plus a short reason that the snapshot records.
"""

from __future__ import annotations

import re
import unicodedata

EEA = frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO".split())
# Non-EEA home markets: OpenFIGI exchange codes that prove a home line, and the home MIC.
HOME = {
    "GB": (("LN",), "XLON"),
    "CH": (("SE", "SW"), "XSWX"),
    "CA": (("CT",), "XTSE"),
    "AU": (("AU", "AT"), "XASX"),
    "SG": (("SP",), "XSES"),
    "IL": (("IT",), "XTAE"),
    "JP": (("JT",), "XTKS"),
    "HK": (("HK",), "XHKG"),
    "ZA": (("SJ",), "XJSE"),
    "US": (("UN", "UW", "UQ", "UR", "UA", "UP"), None),
}
US_EXCHANGE_MIC = {"UN": "XNYS", "UW": "XNAS", "UQ": "XNAS", "UR": "XNAS", "UA": "XASE", "UP": "ARCX"}
# Main OpenFIGI exchange code per operating MIC (derived from micCode-qualified answers).
MAIN_EXCH_CODE = {
    "XAMS": "NA", "XPAR": "FP", "XBRU": "BB", "XLIS": "PL", "XMIL": "IM", "XETR": "GY", "XFRA": "GF",
    "XSTO": "SS", "XHEL": "FH", "XCSE": "DC", "XOSL": "NO", "BMEX": "SQ", "XMAD": "SQ", "XWAR": "PW",
    "XWBO": "AV", "XLON": "LN", "XSWX": "SE", "XDUB": "ID",
}
# Auxiliary segments (midpoint, off-book, auction) collapse onto the operator's lit segment.
LIT_SEGMENT = {
    "DSTO": "XSTO", "MSTO": "XSTO", "PSTO": "XSTO", "DHEL": "XHEL", "MHEL": "XHEL", "PHEL": "XHEL",
    "DCSE": "XCSE", "MCSE": "XCSE", "PCSE": "XCSE", "XEMA": "XETA", "XETU": "XETA", "FRAU": "FRAA",
    "DMAD": "XMAD", "WBMA": "WBAH", "XPMC": "XPAR", "XAMC": "XAMS",
}
LSE_ORDER_BOOK = re.compile(r"^0[0-9A-Z]{3}$")
CURRENCIES = frozenset("EUR USD GBP GBX CHF SEK NOK DKK PLN CZK HUF JPY HKD CAD AUD".split())
CORPORATE_ACTION = re.compile(r"z\.\s?Verk|Andienungs|\bBTA\b|\bBUY ?BACK\b", re.IGNORECASE)
RETIRED_REGISTRATION = frozenset({"RETIRED", "ANNULLED", "DUPLICATE", "MERGED"})
NAME_PREFERENCE = (
    "ALTERNATIVE_LANGUAGE_LEGAL_NAME",
    "PREFERRED_ASCII_TRANSLITERATED_LEGAL_NAME",
    "AUTO_ASCII_TRANSLITERATED_LEGAL_NAME",
)
# Legal-form and programme tokens only. Words such as GROUP or HOLDING stay: dropping
# them links "NN Group N.V." to "NN Inc" and "Ferrari Group PLC" to "Ferrari N.V.".
_LEGAL_FORM = re.compile(
    r"\b(INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|PLC|SA|S A|AG|NV|N V|SE|S E|LLC|LP|L P|"
    r"CLASS [A-Z]|CL [A-Z]|ADR|ADS|SPONSORED|UNSPONSORED)\b"
)
MIN_NAME_KEY = 5


def latin(text: str) -> bool:
    return all(unicodedata.name(ch, "").startswith("LATIN") for ch in text if ch.isalpha())


def display_name(legal_name: str, names: tuple[tuple[str, str, str | None], ...]) -> tuple[str, str]:
    """Pick a Latin-script issuer name from typed GLEIF names.

    Previous and trading names are never used: the first Latin "other name" can
    be a former name (the audit found TREMOR for Nexxen).
    """
    if latin(legal_name):
        return legal_name, "legal_name"
    for wanted in NAME_PREFERENCE:
        for name, kind, _language in names:
            if kind == wanted and latin(name):
                return name, wanted.lower()
    return legal_name, "legal_name_non_latin"


# Re-casing an all-capitals name: legal forms in their usual spelling, particles lower case after the
# first word, and short common words that are not acronyms.
_FORMS = {"INC": "Inc", "CORP": "Corp", "CO": "Co", "LTD": "Ltd", "LLC": "LLC", "PLC": "PLC", "HLDGS": "Hldgs",
          "SPA": "SpA", "KGAA": "KGaA", "GMBH": "GmbH", "OYJ": "Oyj", "PTE": "Pte", "BHD": "Bhd", "TR": "Tr"}
_PARTICLES = frozenset("OF AND THE FOR DE DU DES DER DEN DI DA DEL LA LE VAN VON ET EN AT ON IN".split())
_WORDS = frozenset("AIR ART BAY BIG BIO CAR GAS ICE INN NET NEW OIL ONE PAY RED SEA SKY SUN TOP TWO WAY".split())
# SEC company titles end in a state or filer marker (" /DE/", " /FI", "INC/", "/NEW/") or "/ADR"; "SA/NV" stays.
_SEC_SUFFIX = re.compile(r"(?:\s+/\s*[A-Z]{2,3}/?|/\s*(?:[A-Z]{2,3}/)?|\s*/\s*AD[RS]S?)\s*$", re.IGNORECASE)


def display_case(name: str, tickers: frozenset[str] = frozenset()) -> str:
    """A readable display name: SEC state and ADR suffixes dropped ("/DE/"), and an all-capitals name
    re-cased ("ASML HOLDING N.V." with ticker ASML -> "ASML Holding N.V."). Mixed-case names keep their
    case. Kept upper: dotted forms (N.V., S.A.), the issuer's tickers, words without a vowel and short
    words that are not common words (BP, KPN, ING, NN)."""
    name = _SEC_SUFFIX.sub("", name).strip() or name
    if name != name.upper():
        return name

    def word(token: str, first: bool) -> str:
        plain = re.sub(r"[^A-Z0-9]", "", token)
        if not plain.isalpha() or re.fullmatch(r"(?:[A-Z]\.)+[A-Z]?\.?", token) or plain in tickers:
            return token
        if plain in _FORMS:
            return token.replace(plain, _FORMS[plain])
        if plain in _PARTICLES:
            return token.capitalize() if first else token.lower()
        if not re.search(r"[AEIOUY]", plain) or (len(plain) <= 3 and plain not in _WORDS):
            return token
        cased = re.sub(r"[A-Z]+(?:'[A-Z]+)?", lambda part: part[0].capitalize(), token)
        return re.sub(r"^(Mc|[OD]')([a-z])", lambda part: part[1] + part[2].upper(), cased)

    parts = re.split(r"([\s/-]+)", name)
    return "".join(part if index % 2 else word(part, index == 0) for index, part in enumerate(parts))


def normalized_name(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    folded = re.sub(r"[^A-Z0-9 ]", " ", folded.replace("&", " AND "))
    return " ".join(_LEGAL_FORM.sub(" ", folded).split())


def lit_segment(mic: str) -> str:
    return LIT_SEGMENT.get(mic, mic)


def split_ticker(ticker: str | None) -> tuple[str | None, str | None]:
    """OpenFIGI writes share classes as `BRK/B` or `ABC A`; SEC as `BRK-B`."""
    if not ticker:
        return None, None
    match = re.match(r"^(.+?)[ /-]([A-Z0-9]{1,3})$", ticker)
    return (match.group(1), match.group(2)) if match else (ticker, None)


def split_glued_class(ticker: str, fisn: str | None) -> tuple[str, str] | None:
    """Nordic tickers glue the class on (`NCCA`); the FISN `…/SH A` reveals it."""
    match = re.search(r"/(?:SH|PREF|PRF) ([A-Z])\b", fisn or "")
    if match and len(ticker) > 2 and ticker.endswith(match.group(1)):
        return ticker[:-1], match.group(1)
    return None


def currency_suffixed(ticker: str) -> bool:
    """MTF lines such as `ADYENEUR` repeat the ticker with a trading-currency suffix."""
    return len(ticker) > 4 and ticker[-3:] in CURRENCIES


def pick_figi_row(rows: list[dict], operating_mic: str) -> tuple[dict | None, str]:
    """Choose one OpenFIGI answer row for a venue: main exchange code, no currency-suffixed tickers."""
    if not rows:
        return None, "no_match"
    if len(rows) == 1:
        return rows[0], "single"
    main = MAIN_EXCH_CODE.get(operating_mic)

    def rank(row: dict) -> tuple:
        ticker = row.get("ticker") or ""
        return (
            row.get("exchCode") != main,
            currency_suffixed(ticker),
            row.get("marketSector") not in (None, "Equity"),
            len(ticker),
            ticker,
            row.get("figi") or "",
        )

    return sorted(rows, key=rank)[0], "multi_row_ranked"


def primary_venue(
    isin: str,
    relevant_operating_mic: str | None,
    xetra_live: bool,
    fanout: list[dict],
) -> tuple[str | None, str, dict | None]:
    """FIRDS relevant venue, corrected for non-EEA home markets and Frankfurt floor.

    Returns (operating MIC, rule, OpenFIGI home row when the home line is outside FIRDS).
    """
    country = isin[:2]
    if country in HOME and country not in EEA:
        codes, home_mic = HOME[country]
        home = [
            r for r in fanout
            if r.get("exchCode") in codes and r.get("ticker") and not LSE_ORDER_BOOK.match(r["ticker"])
        ]
        if home:
            row = sorted(home, key=lambda r: (codes.index(r["exchCode"]), r.get("ticker") or ""))[0]
            return home_mic or US_EXCHANGE_MIC[row["exchCode"]], "home_listing_evidence", row
    if relevant_operating_mic == "XFRA" and xetra_live:
        return "XETR", "frankfurt_floor_to_xetra", None
    if relevant_operating_mic:
        return relevant_operating_mic, "firds_relevant_venue", None
    return None, "no_relevant_venue", None


def also_us_listed(fanout: list[dict], share_class_figi: str | None) -> bool:
    return any(
        r.get("exchCode") in US_EXCHANGE_MIC and (share_class_figi is None or r.get("shareClassFIGI") == share_class_figi)
        for r in fanout
    )


def admission_status(
    *,
    as_of: str,
    termination: str | None,
    full_name: str | None,
    cfi: str,
    entity_status: str | None,
    registration_status: str | None,
    venue_count: int,
    has_transparency: bool | None,
    has_figi: bool,
) -> tuple[str, list[str]]:
    """Activity of one FIRDS admission: active, suspect (demote) or inactive (dead).

    FIRDS rarely sets termination dates, so the audit's signals are combined:
    corporate-action lines, retired issuers, FITRS absence and OpenFIGI silence.
    """
    dead: list[str] = []
    doubt: list[str] = []
    if termination and termination <= as_of:
        dead.append("terminated")
    if CORPORATE_ACTION.search(full_name or ""):
        (doubt if has_figi else dead).append("corporate_action_line")
    elif cfi.startswith("ESXX") and not has_figi:
        dead.append("unclassified_line_without_figi")
    if entity_status == "INACTIVE" or (registration_status or "") in RETIRED_REGISTRATION:
        dead.append("issuer_lei_retired")
    if dead:
        return "inactive", dead
    if not has_figi:
        doubt.append("no_openfigi_line")
    if has_transparency is False:
        doubt.append("no_transparency_result")
    if registration_status == "LAPSED" and venue_count == 1:
        doubt.append("lapsed_lei_single_venue")
    if "corporate_action_line" in doubt or (not has_figi and (has_transparency is False or "lapsed_lei_single_venue" in doubt)):
        return "suspect", doubt
    return "active", doubt


def sec_row_class(security_type2: str | None, ticker: str) -> str:
    """Classify a SEC ticker line; non-share lines stay but are labelled, never merged."""
    mapped = {
        "Common Stock": "share", "REIT": "share", "Partnership Shares": "share", "Tracking Stk": "share",
        "Depositary Receipt": "dr", "Preference": "preferred", "Warrant": "warrant", "Right": "right",
        "Unit": "unit", "Mutual Fund": "fund", "ETP": "fund", "Closed-End Fund": "fund",
    }.get(security_type2 or "")
    if mapped:
        return mapped
    if re.search(r"-(WS|WT|W)$", ticker):
        return "warrant"
    if re.search(r"-(U|UN)$", ticker):
        return "unit"
    if re.search(r"-(R|RT)$", ticker):
        return "right"
    if re.search(r"-P[A-Z]*$", ticker):
        return "preferred"
    return "other" if security_type2 else "unknown"
