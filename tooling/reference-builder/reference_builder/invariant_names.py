"""Name, issuer, kind and relation invariants (see `invariants.py`)."""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict

from .invariant_checks import Build
from .rules import latin

MOJIBAKE = re.compile(r"Ã[\x80-\xbf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ¡-¿]|Â[\xa0-\xbf]|â€|�|&(?:amp|quot|#\d+);|[\x00-\x1f\x7f]")
FINANCING_VEHICLE = re.compile(
    r"\b(CAPITAL MARKETS?|FINANCE|FINANCIAL SERVICES|FUNDING|TREASURY|FINANZ|FINANCE B ?V|INTERNATIONAL FINANCE|"
    r"ISSUER|ISSUANCE)\b")
MARKET_OPERATOR = re.compile(
    r"\b(B(?:O|OE)RSEN?|WERTPAPIERB(?:O|OE)RSE|STOCK EXCHANGE|TRADING FACILITY|TP ICAP|TRADEWEB|EURONEXT|MARKETAXESS|CBOE|"
    r"AQUIS|TURQUOISE|BLOOMBERG (?:TRADING|FINANCE|L ?P))\b")  # not a fund named after a Bloomberg index
FUND_WORDS = re.compile(r"\b(UCITS|ETF|ETC|ETN|INDEX FUND|EXCHANGE TRADED)\b")
PREFERRED_WORDS = re.compile(r"\b(VORZUG\w*|VZO?|PREF|PREFERENCE SHARES?|PREFERRED (?:SHARES?|STOCK)|RISP(?:ARMIO)?|PRIVILEGI\w*)\b")
STOP = frozenset("THE AND OF DE LA LE DES DU DER DIE DAS UND ET CO COMPANY GROUP GRUPPE HOLDING HOLDINGS HLDGS INTERNATIONAL "
                 "BANK SHARES SHARE REGISTERED INHABER NAMENS AKTIEN AKTIE ORD ORDINARY COMMON STOCK CLASS NEW INC CORP "
                 "LTD PLC AG SA NV SE ASA AB OYJ SPA KGAA GMBH A B C ON O N".split())


# ---- names --------------------------------------------------------------------


def _bad_casing(text: str) -> bool:
    """A capital right after a small letter where one of the capitals is not ASCII (NestlÉ), or a run of two or
    more capitals, one not ASCII, followed by small letters (MØLler). ASCII camel case (FuturAqua, iShares) is a
    brand's own spelling and is left alone."""
    for word in re.findall(r"[^\W\d_]+", text):
        if word.isupper() or word.islower():
            continue
        for index in range(1, len(word)):
            if word[index].isupper() and word[index - 1].islower() and not word[index].isascii():
                return True
        lead = len(word) - len(word.lstrip("".join(ch for ch in word if ch.isupper())))
        if 2 <= lead < len(word) and word[lead].islower() and not word[:lead].isascii():
            return True
    return False


def name_casing(build: Build) -> list[tuple]:
    rows = [(i["name"], i["id"]) for i in build.issuers.values()]
    rows += [(s["name"], s["id"]) for s in build.securities.values()]
    return [row for row in rows if _bad_casing(row[0])]


def name_not_latin(build: Build) -> list[tuple]:
    """An issuer shown under a non-Latin name: a Latin-script query cannot find it (GLEIF gave no Latin alternative)."""
    return [(i["name"], i["id"]) for i in build.issuers.values() if not latin(i["name"])]


def name_encoding(build: Build) -> list[tuple]:
    rows = [(i["name"], i["id"]) for i in build.issuers.values()]
    rows += [(s["name"], s["id"]) for s in build.securities.values()]
    return [row for row in rows if MOJIBAKE.search(row[0]) or unicodedata.normalize("NFC", row[0]) != row[0]]


# ---- issuers ------------------------------------------------------------------


def _words(text: str | None) -> set[str]:
    folded = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().upper()
    folded = re.sub(r"(?<=[A-Z])[.'’](?=[A-Z])|'S\b|[.'’]", "", folded)  # F.N.B. -> FNB, ALEXANDER'S -> ALEXANDER
    return {w for w in re.findall(r"[A-Z0-9]{3,}", folded) if w not in STOP}


def _issuer_words(build: Build, issuer_id: str, sources: tuple[str, ...] = ("gleif", "esma_firds")) -> set[str]:
    words = _words(build.issuers[issuer_id]["name"])
    for text, source in build.names.get(issuer_id, []):
        if source in sources:
            words |= _words(text)
    return words


def issuer_financing_vehicle(build: Build) -> list[tuple]:
    """A share, receipt or ETF whose issuer is named like a financing vehicle (Nestlé Capital Markets on Nestlé shares)."""
    found = []
    for security in build.securities.values():
        issuer = build.issuers.get(security["issuer_id"] or "")
        if not issuer or not build.live_security(security["id"]) or security["kind"] not in ("ordinary", "preferred", "depositary_receipt"):
            continue
        name = unicodedata.normalize("NFKD", issuer["name"]).encode("ascii", "ignore").decode().upper()
        if FINANCING_VEHICLE.search(name) and not FINANCING_VEHICLE.search(unicodedata.normalize("NFKD", security["name"]).encode("ascii", "ignore").decode().upper()):
            found.append((security["name"], issuer["name"]))
    return found


def _ascii_upper(text: str | None) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().upper()


def issuer_is_market_operator(build: Build) -> list[tuple]:
    """A security whose issuer LEI is a trading venue or its operator (TP ICAP, Bloomberg's MTF, a German
    exchange): FIRDS carries the reporting venue's LEI when the issuer gave none. The operator's own shares are fine."""
    found = []
    for security in build.securities.values():
        issuer_id = security["issuer_id"] or ""
        issuer = build.issuers.get(issuer_id)
        if not issuer or not build.live_security(security["id"]) or not MARKET_OPERATOR.search(_ascii_upper(issuer["name"])):
            continue
        if not _words(security["name"]) & _issuer_words(build, issuer_id):
            found.append((security["name"], issuer["name"]))
    return found


def issuer_name_disjoint(build: Build) -> list[tuple]:
    """A share's name shares no word with any of its LEI issuer's Latin names (Lee Enterprises under Berkshire)."""
    found = []
    for security in build.securities.values():
        issuer_id = security["issuer_id"] or ""
        if (not build.ids.get(issuer_id, {}).get("lei") or not build.live_security(security["id"])
                or security["kind"] not in ("ordinary", "preferred") or not latin(build.issuers[issuer_id]["name"])):
            continue
        words = _words(security["name"])
        if words and not words & _issuer_words(build, issuer_id):
            found.append((security["name"], build.issuers[issuer_id]["name"]))
    return found


def cik_lei_name_disjoint(build: Build) -> list[tuple]:
    """An issuer with a LEI and a CIK whose SEC names share no word with its GLEIF names (a rename, or a wrong link)."""
    found = []
    for issuer_id, ids in build.ids.items():
        if not (ids.get("lei") and ids.get("cik")):
            continue
        sec = set().union(*[_words(text) for text, source in build.names.get(issuer_id, []) if source == "sec"] or [set()])
        if sec and not sec & _issuer_words(build, issuer_id, ("gleif",)):
            found.append((build.issuers[issuer_id]["name"], " / ".join(t for t, s in build.names[issuer_id] if s == "sec")[:60]))
    return found


# ---- kinds and relations -------------------------------------------------------


def fund_named_ordinary(build: Build) -> list[tuple]:
    return [(s["name"],) for s in build.securities.values()
            if s["kind"] == "ordinary" and build.live_security(s["id"]) and FUND_WORDS.search((s["name"] or "").upper())]


def preferred_named_ordinary(build: Build) -> list[tuple]:
    return [(s["name"],) for s in build.securities.values()
            if s["kind"] == "ordinary" and build.live_security(s["id"])
            and PREFERRED_WORDS.search(unicodedata.normalize("NFKD", s["name"] or "").encode("ascii", "ignore").decode().upper())]


def receipt_without_underlying(build: Build) -> list[tuple]:
    linked = {r["from_id"] for r in build.relations if r["type"] == "depositary_receipt_of"}
    return [(s["name"],) for s in build.securities.values()
            if s["kind"] == "depositary_receipt" and build.live_security(s["id"]) and s["id"] not in linked]


def relation_target_missing(build: Build) -> list[tuple]:
    return [((build.securities.get(r["from_id"]) or {}).get("name"), r["to_id"]) for r in build.relations
            if r["to_id"].startswith("security:") and r["to_id"] not in build.securities]


def stale_isin_twin(build: Build) -> list[tuple]:
    """Two live ordinary securities of one issuer with the same name, one without any ticker: an old ISIN left active."""
    groups: dict[tuple[str, frozenset], list[dict]] = defaultdict(list)
    for security in build.securities.values():
        if security["kind"] == "ordinary" and build.live_security(security["id"]) and security["issuer_id"]:
            groups[(security["issuer_id"], frozenset(_words(security["name"])))].append(security)
    found = []
    for members in groups.values():
        with_ticker = [s for s in members if s["id"] in build.isin
                       and any(l["ticker"] and build.live(l) for l in build.by_security.get(s["id"], []))]
        if len(members) > 1 and with_ticker:
            for security in members:
                if security not in with_ticker and security["id"] in build.isin:
                    found.append((security["name"], build.isin.get(security["id"]), f"twin {build.isin.get(with_ticker[0]['id'])}"))
    return found
