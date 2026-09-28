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
# German floor exchanges: FIRDS often names one as the relevant venue of a share whose German
# main market is Xetra (Fresenius on Düsseldorf).
GERMAN_FLOORS = frozenset({"XFRA", "XSTU", "XMUN", "XDUS", "XHAM", "XHAN", "XBER"})
# Nasdaq Stockholm and Copenhagen write a share class after a space (`VOLV B`); OpenFIGI glues it on (`VOLVB`).
# Helsinki writes it glued (`KESKOB`), as Yahoo does.
SPACED_CLASS_VENUES = frozenset({"XSTO", "XCSE"})
US_EXCHANGE_MIC = {"UN": "XNYS", "UW": "XNAS", "UQ": "XNAS", "UR": "XNAS", "UA": "XASE", "UP": "ARCX"}
# Main OpenFIGI exchange code per operating MIC: the code that answers nearly every micCode-qualified job of
# the venue (measured on the cached answers of the FIRDS week of 2026-09-26). Other codes in those answers
# are pan-European MTF rows that repeat the home ticker (Stuttgart's `XS`: `GLE` for Société Générale,
# whose Stuttgart ticker is `SGE`) or currency-suffixed lines. Berlin (`GB`) is Bloomberg's code for the
# venue; OpenFIGI answers almost no Berlin job, so its lines take the German ticker (`country_rows`).
MAIN_EXCH_CODE = {
    "XAMS": "NA", "XPAR": "FP", "XBRU": "BB", "XLIS": "PL", "XMIL": "IM", "XETR": "GY", "XFRA": "GF",
    "XSTO": "SS", "XHEL": "FH", "XCSE": "DC", "XOSL": "NO", "BMEX": "SQ", "XMAD": "SQ", "XWAR": "PW",
    "XWBO": "AV", "XLON": "LN", "XSWX": "SE", "XDUB": "ID",
    "XSTU": "GS", "XMUN": "GM", "XDUS": "GD", "XHAM": "GH", "XHAN": "GI", "XBER": "GB", "TGAT": "TH",
    "ASEX": "GA", "XBUD": "HB", "XBUL": "BU", "XBSE": "RE", "XPRA": "CK", "XBRA": "SK", "XLJU": "SV", "XZAG": "ZA",
    "XLUX": "LX", "XMAL": "MV", "XICE": "IR", "XTAL": "ET", "XLIT": "LH", "XNGM": "NG", "XSAT": "KA",
}
# OpenFIGI rows that describe debt: a debt market sector, or a ticker that is a coupon-and-maturity
# description (`SIEMAD V0 09/07/39 REGS`, `BNP 0 PERP u`). FIRDS types some structured notes and CDO
# "preference shares" as equity; OpenFIGI shows what they are.
DEBT_SECTORS = frozenset({"Corp", "Govt", "Mtge", "Muni", "M-Mkt"})
DEBT_TICKER = re.compile(r"\s(?:PERP|\d{1,2}/\d{1,2}/\d{2,4})\b")
# Venue policy (Pythia-authored). Pan-European venues that trade shares and ETFs listed
# elsewhere: lit and dark MTFs, request-for-quote platforms, systematic internalisers and
# OTFs, by operating MIC. They are not where an instrument lists, so their lines are left
# out unless one is the security's only market. Every other FIRDS venue stays, including
# the German regional exchanges and Tradegate.
TRADING_ONLY_VENUES = frozenset({
    "CCXE", "CCRM",  # Cboe Europe (MTF and regulated market books)
    "AQEU",  # Aquis Exchange Europe
    "TQEX",  # Turquoise Europe
    "ITGL",  # Posit
    "XIGG",  # Instinet Blockmatch Europe
    "SGMU",  # Sigma X Europe
    "OCXE",  # OneChronos Markets Europe
    "TPIC", "ICOT",  # TP ICAP EU MTF and ICAP EU OTF
    "TWEU",  # Tradeweb EU
    "BTFE",  # Bloomberg Trading Facility
    "MANL",  # MarketAxess NL
    "UBSL", "CREM", "XDNB", "AACA",  # systematic internalisers: UBS, Credem, DNB, Crédit Agricole CIB
    "TSAF", "AURB",  # OTFs: TSAF, Aurel
})
# When FIRDS names a trading-only venue as a security's relevant venue, its primary moves
# to another of its lines: lines in the ISIN's country first, then this order (the largest
# EEA equity and ETF markets, then the German floor and retail venue that list most foreign
# shares), then the earliest listing.
PRIMARY_FALLBACK = ("XETR", "XPAR", "XAMS", "XMIL", "XFRA", "TGAT")
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
# Brands whose casing no rule derives.
_BRANDS = {"JPMORGAN": "JPMorgan", "EBAY": "eBay", "ISHARES": "iShares", "PAYPAL": "PayPal", "BLACKROCK": "BlackRock",
           "RELX": "RELX"}
_WORDLIKE = re.compile(r"[^AEIOUY]{0,2}(?:[AEIOUY]+[^AEIOUY]{0,2})+")  # SHELL, META; not ASML or IMCD
# SEC company titles end in a state or filer marker (" /DE/", " /FI", "INC/", "/NEW/", " DE") or "/ADR";
# "SA/NV" stays.
_SEC_SUFFIX = re.compile(r"(?:\s+/\s*[A-Z]{2,3}/?|/\s*(?:[A-Z]{2,3}/)?|\s*/\s*AD[RS]S?|\s+DE)\s*$")


def display_case(name: str, tickers: frozenset[str] = frozenset(), *, sec: bool = False) -> str:
    """A readable display name: an SEC title's state and ADR markers dropped ("/DE/"), and an all-capitals name
    re-cased ("ASML HOLDING N.V." with ticker ASML -> "ASML Holding N.V."). Mixed-case names keep their
    case. Kept upper: dotted forms (N.V., S.A.), the issuer's tickers that are not words (ASML, not
    SHELL), words without a vowel and short words that are not common words (BP, KPN, ING, NN)."""
    if sec:
        name = _SEC_SUFFIX.sub("", name).strip() or name
    if name != name.upper():
        return name

    def word(token: str, first: bool) -> str:
        plain = re.sub(r"[\W_]", "", token)
        if plain in _BRANDS:
            return token.replace(plain, _BRANDS[plain])
        if (not plain.isalpha() or re.fullmatch(r"(?:[A-Z]\.)+[A-Z]?\.?", token)
                or (plain in tickers and not _WORDLIKE.fullmatch(plain))):
            return token
        if plain in _FORMS:
            return token.replace(plain, _FORMS[plain])
        if plain in _PARTICLES:
            return token.capitalize() if first else token.lower()
        if not re.search(r"[AEIOUYÆØŒ]", _unaccented(plain)) or (len(plain) <= 3 and plain not in _WORDS):
            return token
        # Any capital letter, not only ASCII: "NESTLÉ" -> "Nestlé", "MØLLER" -> "Møller".
        cased = re.sub(r"[^\W\d_]+(?:'[^\W\d_]+)?", lambda part: part[0].capitalize(), token)
        cased = cased.replace("i\u0307", "i")  # Turkish dotted İ lower-cases to i + a combining dot
        return re.sub(r"^(Mc|[OD]')([a-z])", lambda part: part[1] + part[2].upper(), cased)

    parts = re.split(r"([\s/-]+)", name)
    return "".join(part if index % 2 else word(part, index == 0) for index, part in enumerate(parts))


def normalized_name(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper()
    folded = re.sub(r"[^A-Z0-9 ]", " ", folded.replace("&", " AND "))
    return " ".join(_LEGAL_FORM.sub(" ", folded).split())


def firds_kind(cfi: str) -> str:
    """Security kind from the CFI code: depositary receipt (ED), exchange-traded fund (CE), preference share
    (EP, and EF convertible preference shares) or share."""
    return {"ED": "dr", "CE": "etf", "EP": "preferred", "EF": "preferred"}.get(cfi[:2], "share")


def lit_segment(mic: str) -> str:
    return LIT_SEGMENT.get(mic, mic)


def _unaccented(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch))


def exchange_ticker(root: str, klass: str | None, operating_mic: str | None) -> str | None:
    """The ticker as the venue writes a share class: `VOLV B` on Nasdaq Nordic, else None (keep the source's)."""
    return f"{root} {klass}" if klass and operating_mic in SPACED_CLASS_VENUES else None


def slash_class(ticker: str) -> str:
    """OpenFIGI's `/` class separator in the provider convention core keys on (`GRF/P` -> `GRF-P`, as the SEC
    writes `BRK-B`); a bare trailing slash (`BA/`, London's `BA.`) is dropped."""
    return ticker.rstrip("/").replace("/", "-")


def debt_like(rows: list[dict]) -> bool:
    """Every OpenFIGI row describes debt (see `DEBT_SECTORS`, `DEBT_TICKER`); no rows is no evidence."""
    return bool(rows) and all(
        r.get("marketSector") in DEBT_SECTORS or DEBT_TICKER.search(r.get("ticker") or "") for r in rows)


def split_ticker(ticker: str | None) -> tuple[str | None, str | None]:
    """OpenFIGI writes share classes as `BRK/B` or `ABC A`; SEC as `BRK-B`."""
    if not ticker:
        return None, None
    match = re.match(r"^(.+?)[ /-]([A-Z0-9]{1,3})$", ticker)
    return (match.group(1), match.group(2)) if match else (ticker, None)


def split_glued_class(ticker: str, fisn: str | None) -> tuple[str, str] | None:
    """Nordic tickers glue the class on (`NCCA`); the FISN reveals it: `…/SH A`, or in Copenhagen `…/B Aktie`."""
    match = re.search(r"/(?:(?:SH|PREF|PRF) ([A-Z])\b|([A-Z]) AKTIE\b)", (fisn or "").upper())
    klass = match and (match.group(1) or match.group(2))
    if klass and len(ticker) > 2 and ticker.endswith(klass):
        return ticker[:-1], klass
    return None


def currency_suffixed(ticker: str) -> bool:
    """MTF lines such as `ADYENEUR` repeat the ticker with a trading-currency suffix."""
    return len(ticker) > 4 and ticker[-3:] in CURRENCIES


def pick_figi_row(rows: list[dict], operating_mic: str) -> tuple[dict | None, str]:
    """Choose one OpenFIGI answer row for a venue: main exchange code, no currency-suffixed or debt tickers."""
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
            bool(DEBT_TICKER.search(ticker)),
            row.get("marketSector") not in (None, "Equity", "Pfd"),
            len(ticker),
            ticker,
            row.get("figi") or "",
        )

    return sorted(rows, key=rank)[0], "multi_row_ranked"


def country_rows(rows: list[dict], country: str | None, code_country: dict[str, str]) -> list[dict]:
    """Rows on the main exchange code of a venue in `country`. Bloomberg gives an instrument one ticker per
    country composite, so these rows carry the ticker of every venue of that country (`SGE` for Société
    Générale on Xetra, Frankfurt, Stuttgart and Berlin alike)."""
    return [r for r in rows if country and code_country.get(r.get("exchCode") or "") == country
            and r.get("ticker") and not currency_suffixed(r["ticker"]) and not DEBT_TICKER.search(r["ticker"])]


# ---- issuers --------------------------------------------------------------------

# Name words that say nothing about which company a name is.
_NAME_STOP = frozenset("THE AND OF DE LA LE DES DU DER DIE DAS UND ET CO COMPANY GROUP GRUPPE HOLDING HOLDINGS HLDGS "
                       "INTERNATIONAL INTL BANK SHARES SHARE SHS REGISTERED REG INHABER NAMENS AKTIEN AKTIE ORD ORDINARY "
                       "COMMON STOCK CLASS NEW INC CORP LTD PLC AG SA NV SE ASA AB OYJ SPA KGAA GMBH LIMITED "
                       "CORPORATION INCORPORATED ADR ADRS ADS GDR GDRS SPONS UNSPONS SPONSORED UNSPONSORED".split())
# A GLEIF legal name of a financing subsidiary (Nestlé Capital Markets, Brambles Finance, Avantor Funding).
FINANCING_VEHICLE = re.compile(r"\b(FINANCE|FINANCING|FUNDING|TREASURY|CAPITAL MARKETS|ISSUANCE|ISSUER)\b")
# A security name that is itself about finance (Japan Securities Fin., Enterprise Finl Services).
_FINANCE_WORD = re.compile(r"^(FIN|FUND|TREAS|ISSU)")
# Where a share description starts in a FIRDS or OpenFIGI name (`Brambles Ltd. Registered Shares o.N.`).
_DESCRIPTOR = re.compile(r"\s(REG|REGISTERED|REGSH|NAMENS|NAM|INHABER|ACTIONS?|ACT|AZIONI|ACC|SHS|SHARES?|SH|ORD|"
                         r"ADRS?|ADSS?|GDRS?|SPONS?|UNSP|UNSPONS|CDIS?|NPV|DL|EO|LS|SF|CD|VORZUG\w*|VZ)\b.*$")


def ascii_upper(text: str | None) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().upper()


def name_words(text: str | None) -> set[str]:
    """Distinctive words of a company or security name (three characters or more, without legal forms)."""
    folded = re.sub(r"(?<=[A-Z])[.'’](?=[A-Z])|'S\b|[.'’]", "", ascii_upper(text))
    return {w for w in re.findall(r"[A-Z0-9]{3,}", folded) if w not in _NAME_STOP}


def company_key(text: str | None) -> str:
    """A security name reduced to its company name, for an exact match against GLEIF legal names
    (`Nestle S.A. (ADRs)`, `NESTLE SA-REG` and `NESTLÉ S.A.` all give `NESTLE`)."""
    return normalized_name(_DESCRIPTOR.sub("", normalized_name(text or "")))


def names_share_word(names_a, names_b) -> bool:
    a = set().union(*(name_words(n) for n in names_a)) if names_a else set()
    b = set().union(*(name_words(n) for n in names_b)) if names_b else set()
    return bool(a & b)


def financing_vehicle_of(entity_name: str, security_names) -> bool:
    """The issuer is a financing subsidiary of the company whose share this is: its legal name is the
    company's name plus a financing word (`Brambles Finance Limited` on `Brambles Ltd.`), and no name of the
    security is about finance itself (`Enterprise Finl Services`, `Japan Securities Fin.` keep their issuer)."""
    upper = ascii_upper(entity_name)
    if not FINANCING_VEHICLE.search(upper):
        return False
    stem = name_words(FINANCING_VEHICLE.sub(" ", upper))
    words = set().union(*(name_words(n) for n in security_names)) if security_names else set()
    return bool(stem & words) and not any(_FINANCE_WORD.match(w) for w in words)


def primary_venue(
    isin: str,
    relevant_operating_mic: str | None,
    xetra_live: bool,
    fanout: list[dict],
) -> tuple[str | None, str, dict | None]:
    """FIRDS relevant venue, corrected for non-EEA home markets and the German floor exchanges.

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
    if relevant_operating_mic in GERMAN_FLOORS and xetra_live:
        return "XETR", "german_floor_to_xetra", None
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
