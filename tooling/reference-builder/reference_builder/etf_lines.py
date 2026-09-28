"""London and SIX lines of UCITS ETFs the build lists in the EEA.

A UCITS ETF (an Irish or Luxembourg fund share class) has one ISIN and several
listings; ESMA FIRDS covers only the EEA venues. OpenFIGI names the London and
SIX lines, one per trading currency, but its answer carries no currency: each
currency is asked for with the `currency` filter (London's pence lines are `GBp`,
recorded as GBP, the currency the listing trades in).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable

from . import rules
from .model import Listing, Snapshot

# OpenFIGI exchange code -> (operating MIC, country, the currencies its ETF lines trade in, as OpenFIGI names them).
VENUES = {"LN": ("XLON", "GB", ("GBp", "USD", "EUR")), "SW": ("XSWX", "CH", ("CHF", "USD", "EUR"))}
CURRENCY = {"GBp": "GBP"}


def add(snap: Snapshot, isins: list[str], figi_map: Callable[[list[dict]], list[dict]]) -> None:
    """Add the London and SIX lines of these ETF ISINs, never as primary (no source names an ETF's home)."""
    audit = snap.audit.setdefault("etf_lines", Counter())
    fanout = figi_map([{"idType": "ID_ISIN", "idValue": isin} for isin in isins])
    jobs = [(isin, code, currency) for isin, answer in zip(isins, fanout)
            for code in sorted({row.get("exchCode") for row in answer.get("data") or []} & set(VENUES))
            for currency in VENUES[code][2]]
    answers = figi_map([{"idType": "ID_ISIN", "idValue": isin, "exchCode": code, "currency": currency}
                        for isin, code, currency in jobs])
    for (isin, code, currency), answer in zip(jobs, answers):
        security = snap.securities.get(f"isin:{isin}")
        row = next(iter(answer.get("data") or []), None)
        if security is None or row is None or not row.get("ticker"):
            continue
        (mic, country, _currencies), trading = VENUES[code], CURRENCY.get(currency, currency)
        listing = Listing(
            listing_id=f"{mic}:{isin}:{trading}", source="openfigi", row_class="etf", security_id=security.security_id,
            issuer_id=security.issuer_id, mic=mic, operating_mic=mic, country=country, currency=trading,
            ticker=rules.home_ticker(row["ticker"]), ticker_source="openfigi", figi=row.get("figi"),
            composite_figi=row.get("compositeFIGI"), share_class_figi=row.get("shareClassFIGI"),
            security_type=row.get("securityType2") or row.get("securityType"), name=row.get("name"),
            status_reasons=["etf_line_from_openfigi"],
        )
        snap.listings.setdefault(listing.listing_id, listing)
        audit[f"lines_{mic}"] += 1
    audit["isins_asked"], audit["isins_with_lines"] = len(isins), len({isin for isin, *_ in jobs})
