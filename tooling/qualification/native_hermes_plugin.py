"""Provider-free core tool dispatch through the real native registry."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch


def verify_plugin_dispatch(*, root: Path, repository: Path, tool_registry_type) -> None:
    core_path = repository / "runtime/managed/core/__init__.py"
    spec = importlib.util.spec_from_file_location("pythia_qualification_core", core_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the managed Pythia core.")
    core = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = core
    spec.loader.exec_module(core)
    registry = tool_registry_type()

    class QualificationContext:
        def register_system_prompt_section(self, *_args, **_kwargs) -> None:
            pass

        def register_platform_handler(self, *_args, **_kwargs) -> None:
            pass

        def register_tool(self, **kwargs) -> None:
            registry.register(**kwargs)

    core.register(QualificationContext())
    state = root / "desk-view"
    state.mkdir(mode=0o700)
    reference, generation = "r" * 43, "g" * 43
    observed = time.time() * 1000
    for filename, value in {
        "generation.json": {"version": 1, "generation": generation},
        reference + ".json": {
            "version": 1, "generation": generation, "owner": "a" * 64,
            "tab_id": "b" * 16, "session_id": "synthetic", "sequence": 0,
            "observed_at": observed, "expires_at": observed + 60_000,
            "view": {"route": "/", "title": "New chat"},
        },
    }.items():
        target = state / filename
        target.write_text(json.dumps(value))
        target.chmod(0o600)
    with patch.dict(os.environ, {"PYTHIA_DESK_VIEW_STATE": str(state)}):
        result = json.loads(registry.dispatch("pythia_desk_view", {"view_reference": reference},
                                             session_id="synthetic", qualification_context=True))
        denied = json.loads(registry.dispatch("pythia_desk_view", {"view_reference": reference},
                                             session_id="other"))
    if result.get("available") is not True or result.get("view") != {"route": "/", "title": "New chat"}:
        raise RuntimeError("Native Hermes registry dispatch rejected the core Desk tool.")
    if denied.get("available") is not False or denied.get("reason") != "different_session":
        raise RuntimeError("Native registry dispatch did not preserve Desk session ownership.")
