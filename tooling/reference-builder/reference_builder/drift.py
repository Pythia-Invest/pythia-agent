"""Drift alarm for core's curated canonical-asset table (`just canonical-assets-drift`).

For every curated asset it asks each coin provider whether the coin id its plugin's contract declares for the asset
(`addressing.subjects`) still names the curated deployments: the id resolves, and on every chain the contract maps
(`addressing.chain_codes`) the id lists the curated contract, and no other coin id of that provider claims it. A
provider that lists more chains than the contract maps is not drift: its grouping is a claim, never identity. Native
(`slip44`) deployments carry no contract and are only checked through the id itself.

Network: CoinGecko `/coins/list?include_platform=true` (keyless, one call) and CoinMarketCap
`/v2/cryptocurrency/info` for the curated ids (one call, the configured `coinmarketcap_api_key`, never printed).
Provider responses stay in memory. Exit status: 0 no drift, 1 drift, 2 a provider could not be checked.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse

from .config import USER_AGENT, load_coinmarketcap_key
from .fetch import HttpError, request
from .schema import CORE

PLUGINS = CORE.parents[1] / "plugins"  # each coin plugin's contract declares its coin ids and chain ids
PROVIDERS = ("coingecko", "coinmarketcap")


def _contract(value: str) -> str:
    """EVM addresses compare case-insensitively; a Sui coin type as a raw type with a long-form address (the curated
    reference is percent-encoded, ADR 0037); other chains' references are exact."""
    if re.fullmatch(r"0x[0-9a-fA-F]{40}", value):
        return value.lower()
    move = re.fullmatch(r"0x([0-9a-fA-F]{1,64})(::\w+::\w+)", urllib.parse.unquote(value))
    return f"0x{move[1].lower():0>64}{move[2]}" if move else value


def declared(provider: str) -> dict:
    """The provider plugin's own addressing (contract version 2): its coin id per asset and its chain ids."""
    return json.loads((PLUGINS / provider / "contract.json").read_text(encoding="utf-8"))["addressing"]


def coins(seed: dict, addressing: dict) -> dict[str, str]:
    """The declared coin id of each curated asset, by its canonical deployment."""
    subjects = addressing.get("subjects", {})
    return {asset["caip19"]: ref["native_id"] for asset in seed["assets"]
            if (ref := subjects.get(f"security:caip19:{asset['caip19']}"))}


def check(seed: dict, addressing: dict, provider: str, listed: dict[str, dict[str, set[str]]]) -> list[str]:
    """Drift findings for one provider. `listed` maps the provider's coin ids to {provider chain: contracts}."""
    chain_of = {caip2: chain for chain, caip2 in addressing.get("chain_codes", {}).items()}
    ids = coins(seed, addressing)
    owners: dict[tuple[str, str], set[str]] = {}
    for coin, platforms in listed.items():
        for chain, contracts in platforms.items():
            for contract in contracts:
                owners.setdefault((chain, _contract(contract)), set()).add(coin)
    found = []
    for asset in seed["assets"]:
        coin = ids.get(asset["caip19"])
        if coin is None:
            found.append(f"{provider} ({asset['symbol']}): its contract declares no coin id")
            continue
        label = f"{provider} {coin} ({asset['symbol']})"
        if coin not in listed:
            found.append(f"{label}: the id no longer resolves")
            continue
        for deployment in (asset["caip19"], *asset.get("deployments", ())):
            caip2, reference = deployment.split("/", 1)
            namespace, contract = reference.split(":", 1)
            chain = chain_of.get(caip2)
            if namespace == "slip44" or chain is None:
                continue
            have = {_contract(value) for value in listed[coin].get(chain, ())}
            if not have:
                found.append(f"{label}: no longer lists {deployment}")
            elif _contract(contract) not in have:
                found.append(f"{label}: lists {', '.join(sorted(have))} on {chain}, not the curated {contract}")
            others = owners.get((chain, _contract(contract)), set()) - {coin}
            if others:
                found.append(f"{label}: {deployment} is also listed under {provider} {', '.join(sorted(others))}")
    return found


def coingecko_listed(rows: list[dict]) -> dict[str, dict[str, set[str]]]:
    return {row["id"]: {chain: {address} for chain, address in (row.get("platforms") or {}).items() if chain and address}
            for row in rows}


def coinmarketcap_listed(data: dict[str, dict]) -> dict[str, dict[str, set[str]]]:
    """Info rows keyed by the chain's own coin id and name slug, as the connector's network key writes them
    (`coinmarketcap/identity.py` network_key): two chains can share a coin id."""
    listed: dict[str, dict[str, set[str]]] = {}
    for coin, row in data.items():
        platforms = listed.setdefault(str(coin), {})
        for item in row.get("contract_address") or []:
            platform = item["platform"]
            name = re.sub(r"[^a-z0-9]+", "-", (platform.get("name") or "").lower()).strip("-")
            platforms.setdefault(f"coin:{platform['coin']['id']}:{name}", set()).add(item["contract_address"])
    return listed


def fetch(provider: str, ids: list[str]) -> dict[str, dict[str, set[str]]]:
    if provider == "coingecko":
        url = "https://api.coingecko.com/api/v3/coins/list?include_platform=true"
        return coingecko_listed(request(url, user_agent=USER_AGENT, timeout=60, attempts=3).json())
    key = load_coinmarketcap_key()
    if key is None:
        raise LookupError("coinmarketcap_api_key is not configured")
    url = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?" + urllib.parse.urlencode(
        {"id": ",".join(ids), "skip_invalid": "true"})
    body = request(url, user_agent=USER_AGENT, headers={"X-CMC_PRO_API_KEY": key}, timeout=60, attempts=3).json()
    return coinmarketcap_listed(body.get("data") or {})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument("--provider", choices=PROVIDERS, action="append", help="check only this provider (repeatable)")
    args = parser.parse_args(argv)
    seed = json.loads((CORE / "canonical_assets.json").read_text(encoding="utf-8"))
    status = 0
    for provider in args.provider or PROVIDERS:
        try:
            addressing = declared(provider)
            found = check(seed, addressing, provider, fetch(provider, list(coins(seed, addressing).values())))
        except (LookupError, HttpError, OSError, ValueError, KeyError) as error:  # OSError: no such contract
            print(f"{provider}: not checked ({error})")
            status = max(status, 2)
            continue
        for line in found:
            print(line)
        print(f"{provider}: {len(seed['assets'])} curated assets, {len(found)} drift findings")
        status = max(status, 1 if found else 0)
    return status


if __name__ == "__main__":
    sys.exit(main())
