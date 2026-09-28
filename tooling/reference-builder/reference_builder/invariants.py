"""Whole-build invariants: rules every row of a reference snapshot must satisfy.

The truth set checks about 270 hand-verified instruments; these rules check every
row, so a systematic error (a notional currency written as the trading currency on
every German line, a casing bug in hundreds of names) shows up as a count rather
than as one example somebody happens to look at. Each invariant is a pure query on
the snapshot file (`invariant_checks.py`, `invariant_names.py`) that returns its
violations. An `error` above its limit fails `just reference-audit`; a `warning`
is printed with its limit, marked when over it, and never fails the command. The
builder records every count in the manifest and never blocks on them.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .invariant_checks import (
    Build, currency_is_issue_country, currency_single_currency_venue, currency_withdrawn, primary_floor_beside_xetra,
    primary_foreign_country, primary_inactive, primary_more_than_one, primary_on_open_market_beside_regulated,
    primary_open_market_beside_us_exchange, security_without_listing, ticker_currency_suffix, ticker_grammar,
    ticker_two_securities, ticker_venue_shape, top_ranked_unreachable, us_share_without_us_line, venue_ticker_coverage)
from .invariant_names import (
    cik_lei_name_disjoint, fund_named_ordinary, issuer_financing_vehicle, issuer_is_market_operator,
    issuer_name_disjoint, name_casing, name_encoding, name_not_latin, preferred_named_ordinary,
    receipt_without_underlying, relation_target_missing, stale_isin_twin)

EXAMPLES = 8


@dataclass(frozen=True)
class Invariant:
    name: str
    severity: str  # error | warning
    rule: str
    check: Callable[["Build"], list[tuple]]
    limit: int = 0
    note: str = ""


@dataclass
class Result:
    name: str
    severity: str
    rule: str
    count: int
    limit: int
    examples: list[tuple] = field(default_factory=list)
    note: str = ""

    @property
    def over(self) -> bool:
        return self.count > self.limit

    @property
    def failed(self) -> bool:
        return self.severity == "error" and self.over


# Limits: 0 where the rule has no legitimate exception, or where the fix is under way and the build must fail
# until it lands (currencies). Otherwise the count measured on the default-scope build of the FIRDS week of
# 2026-09-26, plus 10% for counts of 20 or more so a new week's data does not trip it: a ratchet that catches
# a new systematic error (a jump) without failing on the known rows. Lower a limit when its rows are fixed.
INVARIANTS: tuple[Invariant, ...] = (
    Invariant("currency_single_currency_venue", "error",
              "A line on a venue that quotes everything in one currency (German exchanges, Vienna: EUR) carries another.",
              currency_single_currency_venue, 0, "FIRDS' notional currency written as the trading currency; fix under way"),
    Invariant("currency_withdrawn", "error",
              "A live line's currency is a withdrawn ISO 4217 code (NLG, SKK, HRK, BGN since 2026) or XXX.",
              currency_withdrawn, 0, "stale FIRDS records; a venue trading-currency table fixes them with the rule above"),
    Invariant("currency_is_issue_country", "warning",
              "A line's currency is not its venue country's but exactly its ISIN country's: probably the notional currency.",
              currency_is_issue_country, 4727, "multi-currency venues (Milan ETFplus, Stockholm, RFQ platforms) need review"),
    Invariant("ticker_currency_suffix", "error",
              "A ticker that ends in a currency code (HONAEUR) disagrees with the line's currency.",
              ticker_currency_suffix, 137, "sources disagree on the currency, or a currency-suffixed OpenFIGI row was picked"),
    Invariant("ticker_grammar", "error", "A live ticker fails core's ticker grammar (`BA/`, a bond description).",
              ticker_grammar, 18, "OpenFIGI `/` class tickers and debt rows; core drops their ticker_mic assertion"),
    Invariant("ticker_venue_shape", "warning",
              "A ticker does not have its venue's shape (US 1-5 letters, German 2-6 characters, Euronext 1-6).",
              ticker_venue_shape, 380, "mostly currency-suffixed OpenFIGI rows on German floors"),
    Invariant("ticker_two_securities", "error", "One ticker on one venue names two live securities.",
              ticker_two_securities, 46, "all on Stuttgart: a home-market ticker picked for a Stuttgart line"),
    Invariant("primary_more_than_one", "error", "A security has more than one primary listing.", primary_more_than_one),
    Invariant("primary_inactive", "error", "A live security's primary listing is inactive.",
              primary_inactive, 42, "Frankfurt lines of Canadian shares"),
    Invariant("primary_open_market_beside_us_exchange", "error",
              "A security with a live NYSE/Nasdaq line has its primary on an EEA open-market segment.",
              primary_open_market_beside_us_exchange, 1, "Bending Spoons (Italian ISIN, Nasdaq listing) on Munich"),
    Invariant("primary_floor_beside_xetra", "error",
              "The primary is a German floor exchange's open market although a live Xetra line exists.",
              primary_floor_beside_xetra, 4, "four Munich m:access names; check before lowering"),
    Invariant("primary_open_market_beside_regulated", "warning",
              "The primary is an open-market segment although a live regulated line exists in the ISIN's country.",
              primary_on_open_market_beside_regulated, 3),
    Invariant("primary_foreign_country", "warning",
              "A share with an EEA ISIN has its primary abroad although it has a live regulated line in its own country.",
              primary_foreign_country, 27, "legitimate for Luxembourg holding companies listed elsewhere (ArcelorMittal)"),
    Invariant("venue_ticker_coverage", "error",
              "A listing segment with 200 or more live lines gives fewer than half of them a ticker.",
              venue_ticker_coverage, 12, "Frankfurt and Berlin open market, Hanover, Borsa Italiana ETFplus and GEM, Dublin"),
    Invariant("security_without_listing", "warning", "A live security has no venue line.", security_without_listing, 179,
              "SEC tickers without an exchange"),
    Invariant("top_ranked_unreachable", "warning",
              "One of the 1,000 most notable live shares, receipts or ETFs has no ticker line or no primary.",
              top_ranked_unreachable, 148, "UK, Swiss, Japanese and Canadian home lines are not built yet"),
    Invariant("us_share_without_us_line", "warning",
              "A live share with a US ISIN has no US exchange or OTC line although the build has SEC lines.",
              us_share_without_us_line, 312, "mostly delisted or acquired companies still carried by EU venues"),
    Invariant("name_casing", "error", "A re-cased name has a capital inside a word (NestlÉ, MØLler).", name_casing),
    Invariant("name_encoding", "error", "A name carries mojibake, an HTML entity, a control character or non-NFC text.",
              name_encoding, 3, "source names: `S&amp;P`, `King\ufffds`"),
    Invariant("name_not_latin", "warning", "An issuer's display name is not in Latin script.", name_not_latin, 161),
    Invariant("issuer_is_market_operator", "error",
              "A security's issuer is a trading venue or its operator (TP ICAP, Bloomberg MTF, Frankfurter Wertpapierbörse).",
              issuer_is_market_operator, 686, "FIRDS carries the reporting venue's LEI when an issuer has none"),
    Invariant("issuer_financing_vehicle", "warning",
              "A share or receipt's issuer is named like a financing vehicle (Nestlé Capital Markets).",
              issuer_financing_vehicle, 42),
    Invariant("issuer_name_disjoint", "warning",
              "A share's name shares no word with its LEI issuer's Latin names (Lee Enterprises under Berkshire).",
              issuer_name_disjoint, 1876, "also renames and abbreviated FIRDS names; see issuer_is_market_operator"),
    Invariant("cik_lei_name_disjoint", "warning", "An issuer's SEC names share no word with its GLEIF names.",
              cik_lei_name_disjoint, 292, "mostly renames; a sample of 50 found 3 unrelated entities"),
    Invariant("fund_named_ordinary", "warning", "An ordinary share is named like a fund (UCITS, ETF, ETC).",
              fund_named_ordinary, 4, "SEC crypto ETFs typed as common stock"),
    Invariant("preferred_named_ordinary", "warning", "An ordinary share is named like a preference share (Vorzugsaktie, Pref).",
              preferred_named_ordinary, 4),
    Invariant("receipt_without_underlying", "warning", "A depositary receipt has no underlying share.",
              receipt_without_underlying, 590),
    Invariant("relation_target_missing", "warning", "A relation points to a security outside the file.",
              relation_target_missing, 776),
    Invariant("stale_isin_twin", "warning",
              "An issuer has two live ordinary securities with the same name and only one has a ticker (an old ISIN left active).",
              stale_isin_twin, 81),
)


def run(path: Path, invariants: tuple[Invariant, ...] = INVARIANTS) -> list[Result]:
    build = Build(path)
    results = []
    for invariant in invariants:
        found = invariant.check(build)
        results.append(Result(invariant.name, invariant.severity, invariant.rule, len(found), invariant.limit,
                              found[:EXAMPLES], invariant.note))
    return results


def format_results(results: list[Result]) -> list[str]:
    lines = ["Whole-build invariants (errors above their limit fail the audit):",
             f"  {'invariant':<42}{'level':<9}{'count':>8}{'limit':>7}"]
    for r in results:
        mark = "FAIL" if r.failed else ("over" if r.over else "ok")
        lines.append(f"  {r.name:<42}{r.severity:<9}{r.count:>8}{r.limit:>7}  {mark}")
    for r in results:
        if r.over:
            lines.append(f"  {r.name}: {r.rule}")
            lines += [f"      {' · '.join(str(v) for v in example)}" for example in r.examples[:5]]
    return lines
