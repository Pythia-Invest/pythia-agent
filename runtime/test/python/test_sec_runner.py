from __future__ import annotations

import importlib.util
import os
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

RUNNER = Path(__file__).parents[2] / "managed" / "runner" / "sec.py"
SPEC = importlib.util.spec_from_file_location("pythia_sec_runner", RUNNER)
assert SPEC and SPEC.loader
SEC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SEC)


class FakeCompany:
    def __init__(self, _company: str, *, fail_facts: bool = False):
        self.fail_facts = fail_facts

    def get_filings(self, **kwargs):
        self.filing_kwargs = kwargs
        filing = SimpleNamespace(
            cik=1234567890,
            company="Example Public Company",
            form="10-K",
            filing_date=date(2025, 2, 3),
            accession_no="0000000000-25-000001",
            report_date="2024-12-31",
            primary_document="example-20241231.htm",
            is_xbrl=True,
            is_inline_xbrl=True,
        )
        return SimpleNamespace(latest=lambda count: filing if count == 1 else None)

    def get_facts(self):
        if self.fail_facts:
            raise RuntimeError("synthetic provider detail")
        return [
            SimpleNamespace(
                concept="us-gaap:Revenue",
                label="Revenue",
                numeric_value=123.0,
                unit="USD",
                period_start=date(2024, 1, 1),
                period_end=date(2024, 12, 31),
                fiscal_year=2024,
                fiscal_period="FY",
                filing_date=date(2025, 2, 3),
                form_type="10-K",
                accession="0000000000-25-000001",
            ),
            SimpleNamespace(
                concept="us-gaap:QuarterOnly",
                form_type="10-Q",
            ),
        ]


class SecRunnerTest(unittest.TestCase):
    def test_qualified_operations_and_fields(self):
        with patch.dict(os.environ, {"EDGAR_IDENTITY": "Researcher test@example.invalid"}, clear=True):
            response = SEC.run(
                {"company": "EXAMPLE", "fact_limit": 1},
                company_factory=FakeCompany,
            )

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["filing"]["data"]["form"], "10-K")
        self.assertEqual(response["facts"]["data"][0]["concept"], "us-gaap:Revenue")
        self.assertEqual(len(response["facts"]["data"]), 1)
        self.assertEqual(
            set(response["facts"]["data"][0]),
            {
                "concept", "label", "numeric_value", "unit", "period_start",
                "period_end", "fiscal_year", "fiscal_period", "filing_date",
                "form_type", "accession",
            },
        )

    def test_preserves_partial_sibling_without_error_detail(self):
        with patch.dict(os.environ, {"EDGAR_IDENTITY": "Researcher test@example.invalid"}, clear=True):
            response = SEC.run(
                {"company": "EXAMPLE"},
                company_factory=lambda value: FakeCompany(value, fail_facts=True),
            )

        self.assertEqual(response["status"], "partial")
        self.assertEqual(response["filing"]["status"], "ok")
        self.assertEqual(response["facts"]["error"]["code"], "provider_error")
        self.assertNotIn("synthetic provider detail", str(response))

    def test_missing_identity_and_invalid_input_never_construct_company(self):
        constructed = False

        def factory(_value):
            nonlocal constructed
            constructed = True
            return FakeCompany("unused")

        with patch.dict(os.environ, {}, clear=True):
            missing = SEC.run({"company": "EXAMPLE"}, company_factory=factory)
        with patch.dict(os.environ, {"EDGAR_IDENTITY": "test"}, clear=True):
            invalid = SEC.run({"company": "bad ticker!"}, company_factory=factory)

        self.assertEqual(missing["status"], "missing_configuration")
        self.assertEqual(invalid["status"], "invalid")
        self.assertFalse(constructed)

    def test_rate_limit_shape_keeps_retry_hint_without_exception_text(self):
        class TooManyRequestsError(Exception):
            retry_after = 19

        response = SEC._provider_error(TooManyRequestsError("private detail"))

        self.assertEqual(response["status"], "rate_limit")
        self.assertEqual(response["data"], {"retry_after": 19})
        self.assertNotIn("private detail", str(response))


if __name__ == "__main__":
    unittest.main()
