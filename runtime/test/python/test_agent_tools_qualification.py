"""The agent-tool qualification reads core as committed, not as the assembled run instruments it.

The assembled run appends a disposable context probe to its fixture's copy of core (tooling/qualification/
assembled-fixture.mjs). That probe reads PYTHIA_WORKSPACE when core registers and adds a tool, so a copy taken from
the fixture fails to register in the probe's bare environment and every core operation then resolves to nothing.
"""
from __future__ import annotations

import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[3]
CORE = ROOT / "runtime/managed/core"
FIXTURE = (ROOT / "tooling/qualification/assembled-fixture.mjs").read_text()
CACHE = (ROOT / "tooling/qualification/assembled-cache.mjs").read_text()
SPEC = importlib.util.spec_from_file_location("agent_tools_native", ROOT / "tooling/qualification/agent_tools_native.py")
assert SPEC and SPEC.loader
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


def constant(name: str) -> str:
    return re.search(rf'export const {name} = "([^"]+)"', CACHE).group(1)


def instrument(core: Path) -> None:
    """What instrumentContextProbe does to the fixture's core, taken from its source."""
    source = re.search(r"const CONTEXT_PROBE_SOURCE = `(.*?)`;", FIXTURE, re.DOTALL).group(1)
    for name in ("CONTEXT_TOOL", "CONTEXT_PASS_TOOLSET", "CONTEXT_FAIL_TOOLSET"):
        source = source.replace("${" + name + "}", constant(name))
    with (core / "__init__.py").open("a") as init:
        init.write(source)
    manifest = core / "plugin.yaml"
    manifest.write_text(manifest.read_text().replace("provides_tools:\n", f"provides_tools:\n  - {constant('CONTEXT_TOOL')}\n"))


class ContextProbeTest(unittest.TestCase):
    def test_the_fixtures_context_probe_is_removed_from_the_copy_the_qualification_loads(self):
        with tempfile.TemporaryDirectory() as scratch:
            core = Path(scratch) / "core"
            core.mkdir()
            for name in ("__init__.py", "plugin.yaml"):
                (core / name).write_text((CORE / name).read_text())
            instrument(core)
            self.assertIn("PYTHIA_WORKSPACE", (core / "__init__.py").read_text())
            self.assertIn(constant("CONTEXT_TOOL"), (core / "plugin.yaml").read_text())
            PROBE.without_context_probe(core)
            for name in ("__init__.py", "plugin.yaml"):
                self.assertEqual((core / name).read_text(), (CORE / name).read_text(), name)


if __name__ == "__main__":
    unittest.main()
