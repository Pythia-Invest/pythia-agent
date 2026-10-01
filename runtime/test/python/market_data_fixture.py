"""Loads the market-data feature and core platform as isolated test packages; synthetic helpers.

Invented ZZ-prefixed checksummed ISINs and ibkr-shaped references are test
values, not real securities or provider responses.
"""
import importlib.util
from pathlib import Path
import sys
from types import ModuleType

ROOT = Path(__file__).resolve().parents[2] / "managed/plugins/market-data"
PACKAGE = "market_identity_fixture"
spec = importlib.util.spec_from_file_location(PACKAGE, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
module = importlib.util.module_from_spec(spec)
sys.modules[PACKAGE] = module
# Isolated dependency injection for provider-free domain tests. The assembled
# qualification exercises actual native discovery and dependency ownership.
# Core's platform and identity packages load under a bare stand-in for core, so the interface's own imports
# resolve while core's registration (agent tools, identity operations) stays absent.
CORE = 'pythia_bare_core_fixture'
CORE_ROOT = ROOT.parents[1] / 'core'
sys.modules[CORE] = ModuleType(CORE)
sys.modules[CORE].__path__ = []
for part in ('identity', 'platform'):
    part_spec = importlib.util.spec_from_file_location(f'{CORE}.{part}', CORE_ROOT / part / '__init__.py',
                                                       submodule_search_locations=[str(CORE_ROOT / part)])
    sys.modules[part_spec.name] = importlib.util.module_from_spec(part_spec)
    part_spec.loader.exec_module(sys.modules[part_spec.name])
PLATFORM = CORE + '.platform'
TOOLKIT = PLATFORM + '.connector'
# Feature modules are provider-free: don't execute the native plugin initializer.
from importlib import import_module  # noqa: E402
# What plugins import, bound as core's register() publishes it (core/platform/__init__.py).
platform_module = sys.modules["pythia_platform"] = import_module(PLATFORM + ".v1")
wire = import_module(f"{TOOLKIT}.wire")
connector = import_module(TOOLKIT)


def valid_isin(value):
    digits = "".join(str(int(char, 36)) for char in value)
    total = sum(sum(divmod(int(d) * (2 if i % 2 else 1), 10)) for i, d in enumerate(reversed(digits)))
    return total % 10 == 0


def isin(seed):
    prefix = f"ZZ{seed:09d}"
    return next(prefix + str(i) for i in range(10) if valid_isin(prefix + str(i)))


def native(conid, venue="VENUE_A", currency="USD", route="SMART"):
    return {"provider": "ibkr", "native_scope": "contract", "native_id": str(conid),
            "qualifiers": {"venue": venue, "currency": currency, "route": route}}
