from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime
from typing import Any

MAX_FACTS = 200
COMPANY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$")


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        return value[:500]
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)[:500]


def _result(status: str, data: Any = None, code: str | None = None, message: str | None = None) -> dict[str, Any]:
    error = None if code is None else {"code": code, "message": message or code}
    return {"status": status, "data": data, "error": error}


def _filing(company: Any) -> dict[str, Any]:
    filing = company.get_filings(
        form="10-K", amendments=False, trigger_full_load=False
    ).latest(1)
    if filing is None:
        return _result("ok", None)
    return _result(
        "ok",
        {
            "cik": _json_value(filing.cik),
            "company": _json_value(filing.company),
            "form": _json_value(filing.form),
            "filing_date": _json_value(filing.filing_date),
            "accession_number": _json_value(filing.accession_no),
            "report_date": _json_value(filing.report_date),
            "primary_document": _json_value(filing.primary_document),
            "is_xbrl": _json_value(filing.is_xbrl),
            "is_inline_xbrl": _json_value(filing.is_inline_xbrl),
        },
    )


def _facts(company: Any, limit: int) -> dict[str, Any]:
    facts = company.get_facts()
    if facts is None:
        return _result("ok", [])
    annual = [fact for fact in facts if getattr(fact, "form_type", None) == "10-K"]
    annual.sort(
        key=lambda fact: (
            _json_value(getattr(fact, "filing_date", None)) or "",
            _json_value(getattr(fact, "period_end", None)) or "",
            getattr(fact, "concept", ""),
        ),
        reverse=True,
    )
    rows = []
    for fact in annual[:limit]:
        rows.append(
            {
                "concept": _json_value(getattr(fact, "concept", None)),
                "label": _json_value(getattr(fact, "label", None)),
                "numeric_value": _json_value(getattr(fact, "numeric_value", None)),
                "unit": _json_value(getattr(fact, "unit", None)),
                "period_start": _json_value(getattr(fact, "period_start", None)),
                "period_end": _json_value(getattr(fact, "period_end", None)),
                "fiscal_year": _json_value(getattr(fact, "fiscal_year", None)),
                "fiscal_period": _json_value(getattr(fact, "fiscal_period", None)),
                "filing_date": _json_value(getattr(fact, "filing_date", None)),
                "form_type": _json_value(getattr(fact, "form_type", None)),
                "accession": _json_value(getattr(fact, "accession", None)),
            }
        )
    return _result("ok", rows)


def run(request: dict[str, Any], company_factory: Any = None) -> dict[str, Any]:
    raw_company = request.get("company")
    if not isinstance(raw_company, str) or not COMPANY_PATTERN.fullmatch(raw_company.strip()):
        return _result("invalid", code="invalid_company", message="Company must be a ticker or CIK.")
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        return _result("missing_configuration", code="sec_identity_missing", message="Configure an SEC identity first.")
    try:
        limit = min(MAX_FACTS, max(1, int(request.get("fact_limit", 100))))
    except (TypeError, ValueError):
        return _result("invalid", code="invalid_fact_limit", message="fact_limit must be an integer.")
    if company_factory is None:
        from edgar import Company

        company_factory = Company
    try:
        company = company_factory(raw_company.strip())
    except Exception as error:
        provider_error = _provider_error(error)
        return {"status": "error", "filing": provider_error, "facts": provider_error}

    siblings: dict[str, dict[str, Any]] = {}
    for name, operation in (("filing", _filing), ("facts", lambda target: _facts(target, limit))):
        try:
            siblings[name] = operation(company)
        except Exception as error:
            siblings[name] = _provider_error(error)
    successes = sum(value["status"] == "ok" for value in siblings.values())
    status = "ok" if successes == 2 else "partial" if successes == 1 else "error"
    return {"status": status, **siblings}


def _provider_error(error: Exception) -> dict[str, Any]:
    name = type(error).__name__
    if name == "IdentityNotSetError":
        return _result("missing_configuration", code="sec_identity_missing", message="Configure an SEC identity first.")
    if name == "TooManyRequestsError":
        data = {"retry_after": _json_value(getattr(error, "retry_after", None))}
        return _result("rate_limit", data=data, code="rate_limit", message="SEC rate limit reached.")
    status_code = getattr(error, "status_code", None)
    return _result("error", data={"status_code": status_code}, code="provider_error", message="SEC request failed.")


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
        response = run(request)
    except (ValueError, TypeError, json.JSONDecodeError):
        response = _result("invalid", code="invalid_request", message="Request must be valid JSON.")
    json.dump(response, sys.stdout, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
