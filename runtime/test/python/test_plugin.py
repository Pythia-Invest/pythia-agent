from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from unittest.mock import MagicMock

PLUGIN = Path(__file__).parents[2] / "managed" / "plugin" / "__init__.py"
SPEC = importlib.util.spec_from_file_location("pythia_plugin", PLUGIN)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RegistryContractContext:
    def __init__(self):
        self.sections = []
        self.tools = []

    def register_system_prompt_section(self, *args, **kwargs):
        self.sections.append((args, kwargs))

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def dispatch(self, name, args, **kwargs):
        tool = next(tool for tool in self.tools if tool["name"] == name)
        return tool["handler"](args, **kwargs)


class PluginTest(unittest.TestCase):
    def test_registers_only_native_prompt_and_two_toolsets(self):
        context = RegistryContractContext()
        MODULE.register(context)

        self.assertEqual(len(context.sections), 1)
        prompt = context.sections[0][0][1]
        self.assertNotIn("Basic Memory", prompt)
        self.assertIn("explicit approval", " ".join(prompt.split()))
        self.assertEqual(
            {(tool["name"], tool["toolset"]) for tool in context.tools},
            {
                ("pythia_sec_company", "pythia-sec"),
                ("pythia_eod_prices", "pythia-eodhd"),
            },
        )

    def test_tools_use_the_native_registry_args_dict_dispatch_shape(self):
        context = RegistryContractContext()
        MODULE.register(context)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
            for filename, value in (
                (
                    "settings.json",
                    {"schema_version": 1, "sec_identity": "Researcher test@example.invalid"},
                ),
                (
                    "secrets.json",
                    {"schema_version": 1, "eodhd_api_token": "synthetic-token"},
                ),
            ):
                path = root / filename
                path.write_text(json.dumps(value), encoding="utf-8")
                path.chmod(stat.S_IRUSR | stat.S_IWUSR)
            calls = []

            def run(command, request, environment):
                calls.append((command, request, environment))
                return json.dumps({"status": "ok", "data": [], "error": None})

            environment = {
                "PYTHIA_CONFIG_ROOT": str(root),
                "PYTHIA_MANAGED_ROOT": str(root),
                "PYTHIA_EDGAR_DATA_DIR": str(root / "edgar-data"),
                "PYTHIA_EDGAR_CACHE_DIR": str(root / "edgar-cache"),
            }
            with patch.dict(os.environ, environment, clear=True), patch.object(
                MODULE, "_run", side_effect=run
            ):
                sec = json.loads(
                    context.dispatch(
                        "pythia_sec_company",
                        {"company": "EXAMPLE", "fact_limit": 7},
                        parent_agent=object(),
                    )
                )
                eod = json.loads(
                    context.dispatch(
                        "pythia_eod_prices",
                        {
                            "ticker": "EXAMPLE.US",
                            "from_date": "2025-01-01",
                            "to_date": "2025-01-31",
                            "limit": 3,
                        },
                        parent_agent=object(),
                    )
                )

        self.assertEqual(sec["status"], "ok")
        self.assertEqual(eod["status"], "ok")
        self.assertEqual(calls[0][1], {"company": "EXAMPLE", "fact_limit": 7})
        self.assertEqual(
            calls[1][1],
            {
                "api_token": "synthetic-token",
                "ticker": "EXAMPLE.US",
                "from": "2025-01-01",
                "to": "2025-01-31",
                "limit": 3,
            },
        )

    def test_handlers_reject_arguments_outside_the_registered_schema(self):
        context = RegistryContractContext()
        MODULE.register(context)
        cases = (
            ("pythia_sec_company", "EXAMPLE", "invalid_request"),
            ("pythia_sec_company", {"company": "bad ticker!"}, "invalid_company"),
            (
                "pythia_sec_company",
                {"company": "EXAMPLE", "fact_limit": True},
                "invalid_fact_limit",
            ),
            ("pythia_sec_company", {"company": "EXAMPLE", "other": 1}, "invalid_request"),
            ("pythia_eod_prices", {"ticker": "bad ticker!"}, "invalid_ticker"),
            ("pythia_eod_prices", {"ticker": "EXAMPLE.US", "from_date": None}, "invalid_date"),
            ("pythia_eod_prices", {"ticker": "EXAMPLE.US", "limit": 501}, "invalid_limit"),
            ("pythia_eod_prices", {"ticker": "EXAMPLE.US", "other": 1}, "invalid_request"),
        )
        with patch.object(MODULE, "_run") as run:
            for name, arguments, code in cases:
                with self.subTest(name=name, arguments=arguments):
                    response = json.loads(context.dispatch(name, arguments))
                    self.assertEqual(response["status"], "invalid")
                    self.assertEqual(response["error"]["code"], code)
        run.assert_not_called()

    def test_device_stores_require_private_schema_one_mappings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
            path = root / "secrets.json"
            environment = {"PYTHIA_CONFIG_ROOT": str(root)}
            with patch.dict(os.environ, environment, clear=True):
                missing_file = json.loads(
                    MODULE._eod_prices({"ticker": "EXAMPLE.US"})
                )
                self.assertEqual(missing_file["status"], "missing_configuration")

                invalid_stores = (
                    [],
                    None,
                    {"eodhd_api_token": "synthetic-token"},
                    {"schema_version": 2, "eodhd_api_token": "synthetic-token"},
                    {"schema_version": True, "eodhd_api_token": "synthetic-token"},
                )
                for store in invalid_stores:
                    with self.subTest(store=store):
                        path.write_text(json.dumps(store), encoding="utf-8")
                        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
                        response = json.loads(
                            MODULE._eod_prices({"ticker": "EXAMPLE.US"})
                        )
                        self.assertEqual(response["status"], "invalid_configuration")

                path.write_text(json.dumps({"schema_version": 1}), encoding="utf-8")
                path.chmod(stat.S_IRUSR | stat.S_IWUSR)
                missing_value = json.loads(
                    MODULE._eod_prices({"ticker": "EXAMPLE.US"})
                )
                self.assertEqual(missing_value["status"], "missing_configuration")

    def test_device_stores_reject_invalid_bounded_values(self):
        invalid_values = (
            None,
            "",
            "contains whitespace",
            "x" * 513,
            "control\x7f",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
            path = root / "secrets.json"
            with patch.dict(
                os.environ, {"PYTHIA_CONFIG_ROOT": str(root)}, clear=True
            ):
                for value in invalid_values:
                    with self.subTest(value_type=type(value).__name__):
                        path.write_text(
                            json.dumps(
                                {"schema_version": 1, "eodhd_api_token": value}
                            ),
                            encoding="utf-8",
                        )
                        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
                        response = json.loads(
                            MODULE._eod_prices({"ticker": "EXAMPLE.US"})
                        )
                        self.assertEqual(response["status"], "invalid_configuration")

                settings = root / "settings.json"
                for value in (
                    None,
                    "",
                    "not-an-email",
                    f"Researcher {'x' * 310}@example.invalid",
                    "Researcher test@example.invalid\nInjected",
                ):
                    with self.subTest(sec_value_type=type(value).__name__):
                        settings.write_text(
                            json.dumps({"schema_version": 1, "sec_identity": value}),
                            encoding="utf-8",
                        )
                        settings.chmod(stat.S_IRUSR | stat.S_IWUSR)
                        response = json.loads(
                            MODULE._sec_company({"company": "EXAMPLE"})
                        )
                        self.assertEqual(response["status"], "invalid_configuration")

    def test_malformed_and_mode_unsafe_stores_are_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
            path = root / "secrets.json"
            with patch.dict(os.environ, {"PYTHIA_CONFIG_ROOT": str(root)}, clear=True):
                path.write_text("not json", encoding="utf-8")
                malformed = json.loads(MODULE._eod_prices({"ticker": "EXAMPLE.US"}))
                path.write_text(
                    json.dumps({"schema_version": 1, "eodhd_api_token": "never-print-this"}),
                    encoding="utf-8",
                )
                path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
                unsafe = json.loads(MODULE._eod_prices({"ticker": "EXAMPLE.US"}))

        self.assertEqual(malformed["status"], "invalid_configuration")
        self.assertEqual(unsafe["status"], "invalid_configuration")
        self.assertNotIn("never-print-this", json.dumps(unsafe))

    def test_runner_cancellation_stops_child_and_returns_cancelled(self):
        process = MagicMock()
        process.communicate.side_effect = KeyboardInterrupt()
        with (
            patch.object(MODULE.subprocess, "Popen", return_value=process),
            patch.object(MODULE, "_stop_process") as stop_process,
        ):
            response = json.loads(MODULE._run(["runner"], {}, {}))

        self.assertEqual(response["status"], "cancelled")
        stop_process.assert_called_once_with(process)

    def test_runner_rejects_token_echo(self):
        process = MagicMock()
        process.communicate.return_value = (
            json.dumps({"status": "error", "detail": "never-print-this"}),
            None,
        )
        process.returncode = 0
        with patch.object(MODULE.subprocess, "Popen", return_value=process):
            response = json.loads(
                MODULE._run(["runner"], {"api_token": "never-print-this"}, {})
            )

        self.assertEqual(response["error"]["code"], "unsafe_runner_output")
        self.assertNotIn("never-print-this", json.dumps(response))

    def test_runner_timeout_stops_child(self):
        process = MagicMock()
        process.communicate.side_effect = subprocess.TimeoutExpired("runner", 40)
        with (
            patch.object(MODULE.subprocess, "Popen", return_value=process),
            patch.object(MODULE, "_stop_process") as stop_process,
        ):
            response = json.loads(MODULE._run(["runner"], {}, {}))

        self.assertEqual(response["status"], "timeout")
        stop_process.assert_called_once_with(process)

    def test_runner_rejects_oversized_output(self):
        process = MagicMock()
        process.communicate.return_value = ("x" * (MODULE.MAX_OUTPUT_BYTES + 1), None)
        process.returncode = 0
        with patch.object(MODULE.subprocess, "Popen", return_value=process):
            response = json.loads(MODULE._run(["runner"], {}, {}))

        self.assertEqual(response["error"]["code"], "output_too_large")


if __name__ == "__main__":
    unittest.main()
