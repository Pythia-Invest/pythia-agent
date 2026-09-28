"""Drift alarm for core's curated canonical-asset table (`just canonical-assets-drift`).

For every curated asset it asks each coin provider whether the curated coin id still names the curated
deployments: the id resolves, and on every chain the table maps for that provider (`provider_chains`) the id
lists the curated contract, and no other coin id of that provider claims it. A provider that lists more chains
than the table is not drift: its grouping is a claim, never identity. Native (`slip44`) deployments carry no
contract and are only checked through the id itself.

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

PROVIDERS = ("coingecko", "coinmarketcap")


def _contract(value: str) -> str:
    """EVM addresses compare case-insensitively; other chains' references are exact."""
    return value.lower() if re.fullmatch(r"0x[0-9a-fA-F]{40}", value) else value


def check(seed: dict, provider: str, listed: dict[str, dict[str, set[str]]]) -> list[str]:
    """Drift findings for one provider. `listed` maps the provider's coin ids to {provider chain: contracts}."""
    chain_of = {row["caip2"]: row["chain"] for row in seed["provider_chains"] if row["provider"] == provider}
    owners: dict[tuple[str, str], set[str]] = {}
    for coin, platforms in listed.items():
        for chain, contracts in platforms.items():
            for contract in contracts:
                owners.setdefault((chain, _contract(contract)), set()).add(coin)
    found = []
    for asset in seed["assets"]:
        coin, label = asset[provider], f"{provider} {asset[provider]} ({asset['symbol']})"
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


def fetch(provider: str, seed: dict) -> dict[str, dict[str, set[str]]]:
    if provider == "coingecko":
        url = "https://api.coingecko.com/api/v3/coins/list?include_platform=true"
        return coingecko_listed(request(url, user_agent=USER_AGENT, timeout=60, attempts=3).json())
    key = load_coinmarketcap_key()
    if key is None:
        raise LookupError("coinmarketcap_api_key is not configured")
    ids = ",".join(asset["coinmarketcap"] for asset in seed["assets"])
    url = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?" + urllib.parse.urlencode({"id": ids, "skip_invalid": "true"})
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
            found = check(seed, provider, fetch(provider, seed))
        except (LookupError, HttpError, ValueError, KeyError) as error:
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
