"""Review flags on CIK-to-LEI links. They never decide a link: a shared name word raises a flag, and an exact name
(`linking._named`) is what decides."""

from __future__ import annotations

from . import rules
from .model import Issuer, SecTicker, Snapshot

# Name words too common to show two names belong to one company.
GENERIC_WORDS = frozenset("THE AND OF GROUP HOLDING HOLDINGS INTERNATIONAL INDUSTRIES BANK FINANCIAL CAPITAL TRUST FUND "
                          "PARTNERS TECHNOLOGIES TECHNOLOGY SYSTEMS RESOURCES ENERGY AMERICA AMERICAN GLOBAL NEW".split())


def titles_by_cik(tickers: list[SecTicker]) -> dict[str, str]:
    return {t.cik: t.name for t in reversed(tickers)}  # a CIK's first SEC title


def name_alike(title: str, issuer: Issuer | None) -> bool:
    """Whether a SEC title shares a name word with any GLEIF name of the issuer, or its letters apart from
    spacing ("MOODY S", "F N B"). An issuer GLEIF did not describe (not read, or no record) has only a FIRDS
    instrument name, which names a security, not the entity, so it matches no title. Only a review flag
    (`cik_link_suspect`) uses it: it never decides a link."""
    if issuer is None or issuer.name_rule == "firds_full_name":
        return False
    x = rules.normalized_name(title)
    for name in (issuer.name, *(name for name, *_ in issuer.names)):
        y = rules.normalized_name(name)
        joined = sorted((x.replace(" ", ""), y.replace(" ", "")), key=len)
        if (set(x.split()) & set(y.split())) - GENERIC_WORDS or (joined[0] and joined[1].startswith(joined[0])):
            return True
    return False


def flag_suspect_links(snap: Snapshot, tickers: list[SecTicker], links: dict[str, tuple[str, str]]) -> None:
    """An identifier link whose SEC title matches no GLEIF name of the LEI: a rename, or a wrong LEI in the
    source. Flagged, kept."""
    titles = titles_by_cik(tickers)
    for cik, (lei, rule) in links.items():
        issuer = snap.issuers[f"lei:{lei}"]
        if issuer.name_rule != "firds_full_name" and not name_alike(titles[cik], issuer):
            snap.flag(issuer.issuer_id, "cik_link_suspect", f"cik:{cik}")


def flag_split_issuers(snap: Snapshot) -> None:
    """A CIK-only issuer named like a LEI issuer: probably one company split in two (a CIK linked elsewhere)."""
    by_name = {rules.normalized_name(issuer.name): issuer.issuer_id for issuer in snap.issuers.values() if issuer.lei}
    for issuer in snap.issuers.values():
        key = rules.normalized_name(issuer.name) if not issuer.lei else ""
        if len(key) >= rules.MIN_NAME_KEY and key in by_name:
            snap.flag(issuer.issuer_id, "issuer_split_lei_cik", by_name[key])
