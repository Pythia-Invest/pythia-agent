"""Provider-free managed-plugin dispatch assertions."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def verify_plugin_dispatch(*, root: Path, repository: Path, tool_registry_type) -> None:
    plugin_path = repository / "runtime/managed/plugin/__init__.py"
    plugin_spec = importlib.util.spec_from_file_location(
        "pythia_qualification_plugin", plugin_path
    )
    if plugin_spec is None or plugin_spec.loader is None:
        raise RuntimeError("Could not load the managed Pythia plugin.")
    plugin = importlib.util.module_from_spec(plugin_spec)
    plugin_spec.loader.exec_module(plugin)

    config_root = root / "config"
    config_root.mkdir(mode=0o700)
    for filename, value in (
        (
            "settings.json",
            {
                "schema_version": 1,
                "sec_identity": "Researcher test@example.invalid",
            },
        ),
        (
            "secrets.json",
            {"schema_version": 1, "eodhd_api_token": "synthetic-token"},
        ),
    ):
        path = config_root / filename
        path.write_text(json.dumps(value), encoding="utf-8")
        path.chmod(0o600)

    tool_registry = tool_registry_type()
    provider_calls: list[dict[str, object]] = []

    class QualificationContext:
        def register_system_prompt_section(self, *_args, **_kwargs) -> None:
            return None

        def register_tool(self, **kwargs) -> None:
            tool_registry.register(**kwargs)

    def provider_free_run(_command, request, _environment) -> str:
        provider_calls.append(request)
        return json.dumps({"status": "ok", "data": [], "error": None})

    plugin._run = provider_free_run
    plugin.register(QualificationContext())
    sec_result = json.loads(
        tool_registry.dispatch(
            "pythia_sec_company",
            {"company": "EXAMPLE", "fact_limit": 7},
            qualification_context=True,
        )
    )
    eod_result = json.loads(
        tool_registry.dispatch(
            "pythia_eod_prices",
            {
                "ticker": "EXAMPLE.US",
                "from_date": "2025-01-01",
                "to_date": "2025-01-31",
                "limit": 3,
            },
            qualification_context=True,
        )
    )
    if sec_result.get("status") != "ok" or eod_result.get("status") != "ok":
        raise RuntimeError("Native Hermes registry dispatch rejected a Pythia tool.")
    if provider_calls != [
        {"company": "EXAMPLE", "fact_limit": 7},
        {
            "api_token": "synthetic-token",
            "ticker": "EXAMPLE.US",
            "from": "2025-01-01",
            "to": "2025-01-31",
            "limit": 3,
        },
    ]:
        raise RuntimeError("Native registry dispatch changed Pythia tool arguments.")
