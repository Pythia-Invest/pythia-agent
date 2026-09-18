"""Qualified IBKR/EODHD equity evidence rules; no name or catalogue guessing.

IB API 10.50.2 ContractDetails/Contract: conId is native, secIdList is optional,
primaryExchange is not routing exchange. EODHD Common Stock qualification is
owned by its trusted adapter; catalogue suffixes never establish a venue.
See runtime/contracts/financial-data.md and packages/market-data/IDENTITY.md.
"""
import re

RULE_VERSIONS = {"ibkr_native_contract": "1", "ibkr_instrument_isin": "1", "ibkr_listing": "1",
                 "eodhd_native_catalogue": "1", "eodhd_instrument_isin": "1",
                 "ibkr_eodhd_instrument_isin": "1", "coingecko_native_coin": "1", "coinmarketcap_native_coin": "1"}


def valid_isin(value):
    """ISO 6166 spelling plus the Luhn check digit, without proving assignment."""
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", value):
        return False
    digits = "".join(str(ord(char) - 55) if char.isalpha() else char for char in value)
    total = 0
    for index, char in enumerate(reversed(digits)):
        number = int(char) * (2 if index % 2 else 1)
        total += number // 10 + number % 10
    return total % 10 == 0


def rule_for(native, scope, evidence):
    if native["provider"] == "coinmarketcap" and native["native_scope"] == "coin" and scope == "crypto":
        return "coinmarketcap_native_coin"
    if native["provider"] == "coingecko" and native["native_scope"] == "coin" and scope == "crypto":
        return "coingecko_native_coin"
    if native["provider"] == "eodhd" and native["native_scope"] == "catalogue":
        if scope != "instrument":
            return None
        return "eodhd_instrument_isin" if any(e["scheme"] == "isin" for e in evidence) else "eodhd_native_catalogue"
    if native["provider"] != "ibkr" or native["native_scope"] != "contract":
        return None
    if scope == "listing":
        return "ibkr_listing"
    if scope == "instrument":
        return "ibkr_instrument_isin" if any(e["scheme"] == "isin" for e in evidence) else "ibkr_native_contract"
    return None


def pair_rule(native, target_native, scope):
    if (scope == "instrument" and target_native is not None
            and {native["provider"], target_native["provider"]} == {"ibkr", "eodhd"}
            and all(ref["native_scope"] == {"ibkr": "contract", "eodhd": "catalogue"}[ref["provider"]]
                    for ref in (native, target_native))):
        return "ibkr_eodhd_instrument_isin"
    return None


def facts(native, evidence, scope):
    asserted = [e for e in evidence if e["authority"] == "source_asserted"]
    identifiers = {e["value"] for e in asserted if e["scheme"] == "isin" and e["scope"] == "instrument"}
    native_rows = [e for e in asserted if e["scheme"] == "native" and e["scope"] in ("instrument", "listing")]
    classes = {e["qualifiers"]["share_class"] for e in asserted if "share_class" in e["qualifiers"]}
    listings = [e for e in native_rows if e["scope"] == "listing"]
    venues = {e["qualifiers"]["venue"] for e in listings if "venue" in e["qualifiers"]}
    currencies = {e["qualifiers"]["currency"] for e in listings if "currency" in e["qualifiers"]}
    conflict = (len(identifiers) > 1 or len(classes) > 1 or len(venues) > 1 or len(currencies) > 1
                or any(e["value"] != native["native_id"] for e in native_rows)
                or any(not valid_isin(value) for value in identifiers))
    instrument_native = any(e["scope"] == "instrument" for e in native_rows)
    is_ibkr = native["provider"] == "ibkr" and native["native_scope"] == "contract"
    is_eodhd = native["provider"] == "eodhd" and native["native_scope"] == "catalogue"
    native_known = ((is_ibkr and bool(native_rows) and native["native_id"].isdigit() and int(native["native_id"]) > 0)
                    or (is_eodhd and instrument_native and bool(native["native_id"])))
    listing_known = bool(listings) and len(venues) == len(currencies) == 1 and "SMART" not in venues
    sufficient = not conflict and ((is_ibkr and (native_known or bool(identifiers))) or (is_eodhd and native_known))
    if scope == "listing":
        sufficient = sufficient and is_ibkr and native_known and listing_known
    elif scope != "instrument":
        sufficient = False
    return {"isin": identifiers, "classes": classes, "venues": venues, "currencies": currencies,
            "native_known": native_known, "instrument_native": instrument_native, "sufficient": sufficient, "conflict": conflict}


def compare(native, evidence, target_native, target_evidence, scope):
    """Proof for this native reference against retained subject intent.

    Returns confirmed/candidate/conflicting. Shared actual ISIN proves the
    qualified IBKR/EODHD instrument pair only with native assertions on both sides.
    A differing venue/currency does not contradict an instrument.
    """
    if scope == "crypto" and native["provider"] == target_native["provider"] and native["provider"] in ("coingecko", "coinmarketcap"):
        if native["native_scope"] != "coin" or target_native["native_scope"] != "coin":
            return "candidate"
        def native_proof(ref, records):
            assertions = {e["value"] for e in records if e["authority"] == "source_asserted" and e["scope"] == "crypto" and e["scheme"] == "native"}
            return assertions == {ref["native_id"]}, bool(assertions - {ref["native_id"]})
        left, right = native_proof(native, evidence), native_proof(target_native, target_evidence)
        if left[1] or right[1]:
            return "conflicting"
        return "confirmed" if left[0] and right[0] and native == target_native else "candidate"
    left, right = facts(native, evidence, scope), facts(target_native, target_evidence, scope)
    if left["conflict"] or right["conflict"]:
        return "conflicting"
    if not (left["sufficient"] and right["sufficient"]):
        return "candidate"
    if left["classes"] and right["classes"] and left["classes"] != right["classes"]:
        return "conflicting"
    if left["isin"] and right["isin"] and left["isin"] != right["isin"]:
        return "conflicting"
    if native["provider"] != target_native["provider"]:
        qualified = pair_rule(native, target_native, scope) and left["instrument_native"] and right["instrument_native"]
        return "confirmed" if qualified and left["isin"] & right["isin"] else "candidate"
    if native["provider"] == "eodhd":
        return "confirmed" if native["native_id"] == target_native["native_id"] or left["isin"] & right["isin"] else "candidate"
    same_contract = native["provider"] == target_native["provider"] == "ibkr" and native["native_id"] == target_native["native_id"]
    if scope == "listing":
        if left["venues"] != right["venues"] or left["currencies"] != right["currencies"]:
            return "conflicting"
        return "confirmed" if same_contract else "candidate"
    shared_isin = bool(left["isin"] & right["isin"])
    return "confirmed" if shared_isin or (same_contract and left["native_known"] and right["native_known"]) else "candidate"


class EquityRules:
    """Versioned concrete rules; tests may replace automatic decision for a defect."""
    versions = RULE_VERSIONS

    def evaluate(self, native, evidence, target_native, target_evidence, scope):
        return compare(native, evidence, target_native, target_evidence, scope)
