"""Typed flags on a subject's read: what Pythia's data leaves uncertain or unknown about it (the vision's "What the
agent sees"; ADR 0044 A6). Each is derived only from what composing the subject's page already loaded.

A closed vocabulary, each flag a `code` with an optional `detail`:

- `conflicting_identifier`: confirm-level sources disagree on one identifier, so neither value applies; the detail
  gives the scheme and each value with its sources.
- `identity_question_open`: open identity questions about the subject or its family; the detail gives their count and
  reasons.
- `issuer_unknown`: a share (not a crypto asset) whose issuer the data does not settle.
- `successor`: a corporate action changed a natural key; the detail names the subject this one succeeds, or the one
  that succeeded it.
- `not_active`: the security or the listing in use is inactive or of unknown status.
- `trading_currency_unknown`: the listing in use has no decided trading currency.
- `not_exchange_traded`: none of the instrument's own lines is on a regulated market or a US exchange.
- `no_home_country_line`: none of the instrument's own lines is in its ISIN's or issuer's country (limited coverage).
"""
from __future__ import annotations

from typing import Any

SUCCESSOR_OF = "successor_of"


def derive(subject: dict[str, Any], queue: list[dict]) -> list[dict[str, Any]]:
    """The flags of a composed subject (`Identity._compose`: its view's listings are the instrument's lines) and its
    open queue items."""
    view, security, listing = subject["view"], subject.get("security"), subject.get("listing")
    found: list[dict[str, Any]] = []

    def flag(code: str, detail: Any = None) -> None:
        found.append({"code": code, **({"detail": detail} if detail is not None else {})})

    for scheme, values in (view.get("contested") or {}).items():
        flag("conflicting_identifier", {"scheme": scheme, "values": values})
    if queue:
        flag("identity_question_open", {"count": len(queue), "reasons": sorted({item["reason"] for item in queue})})
    if subject.get("asset_class") == "equity" and view.get("security") and not view.get("issuer"):
        flag("issuer_unknown")
    for item in view.get("related", []):
        if item["type"] == SUCCESSOR_OF:
            flag("successor", {"succeeds" if item["direction"] == "to" else "succeeded_by": item["id"]})
    status = {level: row["status"] for level, row in (("security", security), ("listing", listing))
              if row is not None and row["status"] != "active"}
    if status:
        flag("not_active", status)
    if listing is not None and subject.get("asset_class") != "crypto" and not listing["trading_currency"]:
        flag("trading_currency_unknown")
    own = [line for line in view.get("listings", []) if not line.get("folded")]
    if own and all(line.get("regulated") is False for line in own):  # lines outside the directory say neither
        flag("not_exchange_traded")
    if own and all(line.get("home_country") is False for line in own):
        flag("no_home_country_line")
    return found
