"""Whole-build invariants: rules every row of a reference snapshot must satisfy.

The truth set checks about 270 hand-verified instruments; these rules check every
row, so a systematic error (a notional currency written as the trading currency on
every German line, a trading venue recorded as issuer) shows up as a count rather
than as one example somebody happens to look at. Each invariant is a pure query on
the snapshot file (`invariant_checks.py`, `invariant_names.py`) that returns its
violating rows. An `error` above its limit fails `just reference-audit`; a
`warning` is printed with its limit and never fails the command. A count below its
limit is reported as `under (lower to N)`. On a failure the audit lists the rows
that are new since the previous build, so the report points at what changed. The
builder records every count in the manifest and never blocks on them.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .invariant_checks import (
    Build, currency_is_issue_country, primary_missing, questions_open, share_primary_silent, currency_single_currency_venue, currency_withdrawn, primary_floor_beside_xetra,
    primary_inactive, primary_more_than_one, primary_open_market_beside_us_exchange, ticker_currency_suffix,
    ticker_two_securities, us_share_without_us_line, venue_ticker_coverage)
from .invariant_names import (
    issuer_financing_vehicle, issuer_is_market_operator, name_casing, name_encoding, stale_isin_twin)

EXAMPLES = 5


@dataclass(frozen=True)
class Invariant:
    name: str
    severity: str  # error | warning
    rule: str
    check: Callable[["Build"], list[tuple]]
    limit: int = 0
    note: str = ""
    # Weekly-drift allowance for known debt, as a share of `limit` (written drift / count as measured), so it
    # shrinks with the limit when a fix lowers it and is 0 once the rule is cleared.
    headroom: float = 0.0


@dataclass
class Result:
    name: str
    severity: str
    rule: str
    count: int
    limit: int
    rows: list[tuple] = field(default_factory=list, repr=False)
    note: str = ""
    headroom: int = 0  # rows allowed above `limit`: the invariant's share applied to its limit

    @property
    def over(self) -> bool:
        return self.count > self.limit + self.headroom

    @property
    def failed(self) -> bool:
        return self.severity == "error" and self.over

    @property
    def mark(self) -> str:
        if self.over:
            return "FAIL" if self.failed else "over"
        return f"under (lower to {self.count})" if self.count < self.limit else "ok"

    def summary(self) -> dict:
        return {"name": self.name, "severity": self.severity, "count": self.count, "limit": self.limit,
                "headroom": self.headroom,
                "examples": [list(map(str, row)) for row in self.rows[:EXAMPLES]]}


# Limits are exact counts on the default-scope build of the FIRDS week of 2026-09-26; a count below its limit
# is reported as `under (lower to N)`, and a fix lowers the limit in the same change. Known debt with a pending
# fix also has headroom: twice the drift measured against the week of 2026-09-19 (a few rows where it did not
# move), as a share of the count, so ordinary weekly data passes, a jump fails, and the allowance shrinks with
# every lowered limit. Guards (rules at 0, small counts that did not move) have none. Warnings never fail.
# Raising a limit needs a stated reason in the pull request.
INVARIANTS: tuple[Invariant, ...] = (
    # Currency
    Invariant("currency_single_currency_venue", "error",
              "A line on a venue that quotes everything in one currency (German exchanges, Vienna: EUR) shows another.",
              currency_single_currency_venue),
    Invariant("currency_withdrawn", "error",
              "A live line's currency is a withdrawn ISO 4217 code (NLG, SKK, HRK, BGN since 2026) or XXX.",
              currency_withdrawn, 112, "stale FIRDS records in the key currency (FIRDS field 13)", headroom=12 / 112),
    Invariant("currency_is_issue_country", "error",
              "Outside RFQ platforms and internalisers, a line shows its ISIN country's currency, not its venue country's.",
              currency_is_issue_country),
    Invariant("ticker_currency_suffix", "error",
              "A ticker that ends in a currency code (HONAEUR) disagrees with the line's currency.",
              ticker_currency_suffix, 92, "weekly drift 38", headroom=2 * 38 / 124),
    # Tickers
    Invariant("ticker_two_securities", "error", "One ticker on one venue names two live securities.",
              ticker_two_securities, 41, "all on Stuttgart: a home-market ticker picked for a Stuttgart line",
              headroom=5 / 41),
    Invariant("venue_ticker_coverage", "error",
              "A listing segment with 200 or more live lines gives fewer than half of them a ticker.",
              venue_ticker_coverage, 12, "Frankfurt and Berlin open market, Hanover, Borsa Italiana ETFplus and GEM, Dublin"),
    # Primary listing
    Invariant("primary_more_than_one", "error", "A security has more than one primary listing.", primary_more_than_one),
    Invariant("primary_inactive", "error", "A live security's primary listing is inactive.", primary_inactive),
    Invariant("primary_missing", "error", "A live security has lines but no primary: its evidence did not decide one.",
              primary_missing, 11997, "primaries the evidence does not decide, a coverage count (ADR 0044, A5), and SEC "
              "or OpenFIGI gaps (claims step 3)", headroom=0.02),
    Invariant("share_primary_silent", "error",
              "A live share has neither a primary nor a most-liquid line.",
              share_primary_silent, 1072, "1,052 SEC OTC-only shares, which no rule places; 20 shares whose most liquid "
              "venue has no line", headroom=0.02),
    Invariant("questions_open", "error", "A question the build left open (the package's claims file).",
              questions_open, 1037, "evidence that does not decide (claims step 3)", headroom=0.02),
    Invariant("primary_open_market_beside_us_exchange", "error",
              "A security with a live NYSE/Nasdaq line has its primary on an EEA open-market segment.",
              primary_open_market_beside_us_exchange),
    # Names and issuers
    Invariant("name_casing", "error", "A re-cased name has a capital inside a word (NestlÉ, MØLler).", name_casing),
    Invariant("name_encoding", "error", "A name carries mojibake, an HTML entity, a control character or non-NFC text.",
              name_encoding, 3, "source names: `S&amp;P`, `King\ufffds`"),
    Invariant("issuer_is_market_operator", "error",
              "A security's issuer is a trading venue or its operator (TP ICAP, Bloomberg MTF, Frankfurter Wertpapierbörse).",
              issuer_is_market_operator, 27, "ETFs on Bloomberg indices (a name match, not an error); AG3I under "
              "Euronext Paris and two US shares under Bloomberg Finance, wrong in FIRDS field 5: fixed by the SEC "
              "registrant issuer claim (SEC onboarding)", headroom=2 * 2 / 27),
    # Warnings: lifecycle and issuer mistakes to review
    Invariant("us_share_without_us_line", "warning",
              "A live share with a US ISIN has no US exchange or OTC line although the build has SEC lines.",
              us_share_without_us_line, 284, "mostly delisted or acquired companies still carried by EU venues"),
    Invariant("stale_isin_twin", "warning",
              "An issuer has two live ordinary securities with the same name and only one has a ticker (an old ISIN left active).",
              stale_isin_twin, 76),  # home lines, now written, show 4 more (Capital Gearing, Anglesey Mining)
    Invariant("issuer_financing_vehicle", "warning",
              "A share or receipt's issuer is named like a financing vehicle (Nestlé Capital Markets).", issuer_financing_vehicle, 36),
    Invariant("primary_floor_beside_xetra", "warning",
              "The primary is a German floor exchange's open market although a live Xetra line exists.",
              primary_floor_beside_xetra, 52, "floor listings the issuer requested (RTS 23 field 8: Düsseldorf, Munich "
              "m:access), beside Xetra lines it did not"),
)


def run(path: Path, invariants: tuple[Invariant, ...] | None = None) -> list[Result]:
    build = Build(path)
    results = []
    for invariant in INVARIANTS if invariants is None else invariants:
        found = invariant.check(build)
        results.append(Result(invariant.name, invariant.severity, invariant.rule, len(found), invariant.limit, found,
                              invariant.note, math.ceil(round(invariant.headroom * invariant.limit, 6))))
    return results


def row_key(row: tuple) -> str:
    """A row's subject ID (its last value) where the rule reports one, else its first value (a ticker@MIC, a venue)."""
    last = str(row[-1])
    return last if last.startswith(("listing:", "security:", "issuer:")) else str(row[0])


def new_rows(result: Result, previous: list[Result] | None) -> list[tuple] | None:
    """Rows of `result` whose key (`row_key`) the previous build's same rule did not report."""
    before = next((r for r in previous or [] if r.name == result.name), None)
    if before is None:
        return None
    seen = {row_key(row) for row in before.rows}
    return [row for row in result.rows if row_key(row) not in seen]


def format_results(results: list[Result], previous: list[Result] | None = None, label: str = "") -> list[str]:
    lines = ["Whole-build invariants (errors above their limit fail the audit):",
             f"  {'invariant':<42}{'level':<9}{'count':>8}{'limit':>8}{'drift':>7}"]
    lines += [f"  {r.name:<42}{r.severity:<9}{r.count:>8}{r.limit:>8}{('+' + str(r.headroom)) if r.headroom else '':>7}  {r.mark}"
              for r in results]
    for r in results:
        if not r.over:
            continue
        fresh = new_rows(r, previous)
        lines.append(f"  {r.name}: {r.rule}")
        if fresh is None:
            lines.append("    examples (no previous build to compare with):")
            shown = r.rows[:EXAMPLES]
        else:
            lines.append(f"    {len(fresh)} rows new since {label or 'the previous build'}:")
            shown = fresh[:20]
        lines += [f"      {' · '.join(str(v) for v in row)}" for row in shown]
    return lines
