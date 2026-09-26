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
PLATFORM = 'pythia_platform_fixture'
platform_root = ROOT.parents[1] / 'core' / 'platform'
platform_spec = importlib.util.spec_from_file_location(PLATFORM, platform_root / '__init__.py',
                                                     submodule_search_locations=[str(platform_root)])
platform_module = importlib.util.module_from_spec(platform_spec)
sys.modules[PLATFORM] = platform_module
platform_spec.loader.exec_module(platform_module)
dependency = ModuleType(PACKAGE + '._platform')
dependency.platform = lambda: platform_module
dependency.price_sources = lambda subject_id: None  # no core identity unless a test injects one
sys.modules[dependency.__name__] = dependency
# Feature modules are provider-free: don't execute the native plugin initializer.
from importlib import import_module  # noqa: E402
wire = import_module(f"{PACKAGE}.wire")


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
