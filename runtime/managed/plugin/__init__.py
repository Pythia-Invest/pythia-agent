from __future__ import annotations

import json
import os
import re
import signal
import subprocess
from pathlib import Path
from typing import Any

MAX_OUTPUT_BYTES = 1_000_000
DEFAULT_TIMEOUT_SECONDS = 40
CHILD_ENV_KEYS = (
    "HOME",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LANG",
    "LC_ALL",
    "NO_PROXY",
    "PATH",
    "REQUESTS_CA_BUNDLE",
    "SSL_CERT_FILE",
)

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SEC_COMPANY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$")
EOD_TICKER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,31}$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

OPERATING_CONTEXT = """Pythia uses evidence before judgment, keeps provider
failures explicit, and preserves source links when research should outlive the
conversation. Managed source is release-owned. Before editing it, explain the
exact diff and fork/update consequence and obtain the user's explicit
approval."""

SEC_SCHEMA = {
    "name": "pythia_sec_company",
    "description": "Read the latest non-amended 10-K metadata and bounded SEC facts.",
    "parameters": {
        "type": "object",
        "properties": {
            "company": {
                "type": "string",
                "description": "Ticker or CIK.",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9.\\-]{0,19}$",
            },
            "fact_limit": {"type": "integer", "minimum": 1, "maximum": 200},
        },
        "required": ["company"],
        "additionalProperties": False,
    },
}

EOD_SCHEMA = {
    "name": "pythia_eod_prices",
    "description": "Read bounded daily end-of-day prices from EODHD.",
    "parameters": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Exchange-qualified ticker.",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9.\\-]{0,31}$",
            },
            "from_date": {
                "type": "string",
                "description": "Optional YYYY-MM-DD.",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
            },
            "to_date": {
                "type": "string",
                "description": "Optional YYYY-MM-DD.",
                "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 500},
        },
        "required": ["ticker"],
        "additionalProperties": False,
    },
}


def _error(status: str, code: str, message: str) -> str:
    return json.dumps(
        {
            "status": status,
            "data": None,
            "error": {"code": code, "message": message},
        }
    )


def _valid_sec_identity(value: Any) -> bool:
    if not isinstance(value, str) or not value or len(value) > 320:
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        return False
    parts = value.strip().split()
    return len(parts) >= 2 and EMAIL_PATTERN.fullmatch(parts[-1]) is not None


def _valid_eodhd_token(value: Any) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= 512
        and not any(character.isspace() for character in value)
        and not any(ord(character) < 32 or ord(character) == 127 for character in value)
    )


def _read_device_value(filename: str, key: str) -> tuple[str, str | None]:
    config_root = os.environ.get("PYTHIA_CONFIG_ROOT")
    if not config_root:
        return ("missing", None)
    root = Path(config_root)
    path = root / filename
    try:
        if root.is_symlink() or root.stat().st_mode & 0o077:
            return ("invalid", None)
        if path.is_symlink():
            return ("invalid", None)
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            return ("invalid", None)
        store = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ("missing", None)
    except (OSError, ValueError, TypeError):
        return ("invalid", None)
    if not isinstance(store, dict):
        return ("invalid", None)
    if type(store.get("schema_version")) is not int or store["schema_version"] != 1:
        return ("invalid", None)
    if key not in store:
        return ("missing", None)
    value = store[key]
    valid = (
        _valid_sec_identity(value)
        if key == "sec_identity"
        else _valid_eodhd_token(value)
        if key == "eodhd_api_token"
        else False
    )
    if not valid:
        return ("invalid", None)
    assert isinstance(value, str)
    return ("configured", value.strip())


def _managed_root() -> Path | None:
    raw = os.environ.get("PYTHIA_MANAGED_ROOT")
    if not raw:
        return None
    source = Path(raw)
    if source.is_symlink():
        return None
    root = source.resolve()
    return root if root.is_dir() else None


def _stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        process.wait(timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=2)
        except OSError:
            pass
        except subprocess.TimeoutExpired:
            pass


def _run(command: list[str], request: dict[str, Any], env: dict[str, str]) -> str:
    process: subprocess.Popen[str] | None = None
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            env=env,
            start_new_session=os.name == "posix",
        )
        stdout, _stderr = process.communicate(
            json.dumps(request), timeout=DEFAULT_TIMEOUT_SECONDS
        )
        if len(stdout.encode("utf-8")) > MAX_OUTPUT_BYTES:
            return _error(
                "error",
                "output_too_large",
                "The provider result exceeded the Pythia limit.",
            )
        token = request.get("api_token")
        if isinstance(token, str) and token and token in stdout:
            return _error(
                "error",
                "unsafe_runner_output",
                "The provider runner returned unsafe output.",
            )
        if process.returncode != 0:
            return _error("error", "runner_failed", "The managed provider runner failed.")
        parsed = json.loads(stdout)
        return json.dumps(parsed, separators=(",", ":"))
    except subprocess.TimeoutExpired:
        if process is not None:
            _stop_process(process)
        return _error(
            "timeout",
            "deadline_exceeded",
            "The provider request exceeded its deadline.",
        )
    except KeyboardInterrupt:
        if process is not None:
            _stop_process(process)
        return _error("cancelled", "cancelled", "The provider request was cancelled.")
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        if process is not None:
            _stop_process(process)
        return _error("error", "runner_unavailable", "The managed provider runner is unavailable.")


def _sec_company(args: dict[str, Any], **_kwargs: Any) -> str:
    if not isinstance(args, dict) or any(
        key not in {"company", "fact_limit"} for key in args
    ):
        return _error(
            "invalid",
            "invalid_request",
            "SEC arguments must match the tool schema.",
        )
    company = args.get("company")
    if (
        not isinstance(company, str)
        or SEC_COMPANY_PATTERN.fullmatch(company.strip()) is None
    ):
        return _error("invalid", "invalid_company", "Company must be a ticker or CIK.")
    fact_limit = args.get("fact_limit", 100)
    if type(fact_limit) is not int or not 1 <= fact_limit <= 200:
        return _error(
            "invalid",
            "invalid_fact_limit",
            "fact_limit must be an integer from 1 to 200.",
        )
    readiness, identity = _read_device_value("settings.json", "sec_identity")
    if readiness == "invalid":
        return _error(
            "invalid_configuration",
            "sec_settings_invalid",
            "The SEC settings store is invalid or unsafe.",
        )
    if identity is None:
        return _error(
            "missing_configuration",
            "sec_identity_missing",
            "Configure an SEC identity first.",
        )
    root = _managed_root()
    if root is None:
        return _error("error", "runner_unavailable", "The managed runtime root is unavailable.")
    data_dir = os.environ.get("PYTHIA_EDGAR_DATA_DIR")
    cache_dir = os.environ.get("PYTHIA_EDGAR_CACHE_DIR")
    if not data_dir or not cache_dir:
        return _error(
            "error",
            "runner_unavailable",
            "The SEC runner state directories are unavailable.",
        )
    env = {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}
    env.update(
        EDGAR_CACHE_DIR=cache_dir,
        EDGAR_IDENTITY=identity,
        EDGAR_LOCAL_DATA_DIR=data_dir,
        EDGARTOOLS_STRICT_ERRORS="true",
    )
    python = os.environ.get("PYTHIA_PYTHON", "python3")
    return _run(
        [python, str(root / "runner" / "sec.py")],
        {"company": company.strip(), "fact_limit": fact_limit},
        env,
    )


def _eod_prices(args: dict[str, Any], **_kwargs: Any) -> str:
    if not isinstance(args, dict) or any(
        key not in {"ticker", "from_date", "to_date", "limit"} for key in args
    ):
        return _error(
            "invalid",
            "invalid_request",
            "EODHD arguments must match the tool schema.",
        )
    ticker = args.get("ticker")
    if (
        not isinstance(ticker, str)
        or EOD_TICKER_PATTERN.fullmatch(ticker.strip()) is None
    ):
        return _error("invalid", "invalid_ticker", "Ticker must be exchange-qualified.")
    from_date = args.get("from_date")
    to_date = args.get("to_date")
    if any(
        key in args
        and (
            not isinstance(args[key], str)
            or DATE_PATTERN.fullmatch(args[key]) is None
        )
        for key in ("from_date", "to_date")
    ):
        return _error("invalid", "invalid_date", "Dates must use YYYY-MM-DD.")
    limit = args.get("limit", 200)
    if type(limit) is not int or not 1 <= limit <= 500:
        return _error(
            "invalid",
            "invalid_limit",
            "limit must be an integer from 1 to 500.",
        )
    readiness, token = _read_device_value("secrets.json", "eodhd_api_token")
    if readiness == "invalid":
        return _error(
            "invalid_configuration",
            "secret_store_invalid",
            "The secret store is invalid or unsafe.",
        )
    if token is None:
        return _error(
            "missing_configuration",
            "eodhd_token_missing",
            "Configure an EODHD token first.",
        )
    root = _managed_root()
    if root is None:
        return _error("error", "runner_unavailable", "The managed runtime root is unavailable.")
    env = {key: os.environ[key] for key in CHILD_ENV_KEYS if key in os.environ}
    return _run(
        [os.environ.get("PYTHIA_NODE", "node"), str(root / "runner" / "dist" / "eodhd.js")],
        {
            "api_token": token,
            "ticker": ticker.strip(),
            "from": from_date,
            "to": to_date,
            "limit": limit,
        },
        env,
    )


def register(ctx: Any) -> None:
    ctx.register_system_prompt_section(
        "pythia.operating",
        OPERATING_CONTEXT,
        position="after_memory",
        max_chars=4000,
    )
    ctx.register_tool(
        name="pythia_sec_company",
        toolset="pythia-sec",
        schema=SEC_SCHEMA,
        handler=_sec_company,
        description="Latest 10-K metadata and bounded SEC facts",
    )
    ctx.register_tool(
        name="pythia_eod_prices",
        toolset="pythia-eodhd",
        schema=EOD_SCHEMA,
        handler=_eod_prices,
        description="Bounded daily EODHD prices",
    )
