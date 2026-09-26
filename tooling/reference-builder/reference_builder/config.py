"""Build scope, paths and credential loading for the reference snapshot builder."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent.parent
# Outputs and downloads are data: they live under the checkout's ignored `.local/`.
WORK_DIR = TOOL_DIR.parent.parent / ".local" / "reference-builder"
BUILDER_VERSION = "1"

# Generic project identification; personal contacts never belong in source.
USER_AGENT = "pythia-agent reference builder (contact via github.com/Pythia-Invest)"
# SEC fair-access rules require a reachable contact mailbox in the User-Agent.
SEC_USER_AGENT = "pythia-agent reference builder {contact}"
OPENFIGI_KEY_ENV = "OPENFIGI_API_KEY"
_CONTACT_SHAPE = re.compile(r"\S+@\S+\.\S+")


@dataclass(frozen=True)
class Scope:
    """Which venues and populations a build covers."""

    mics: tuple[str, ...] = ("XAMS",)
    sec: bool = True
    cfi_prefixes: tuple[str, ...] = ("ES", "ED")

    def describe(self) -> dict:
        return {
            "mics": list(self.mics),
            "sec": self.sec,
            "cfi_prefixes": list(self.cfi_prefixes),
        }


@dataclass(frozen=True)
class BuildConfig:
    scope: Scope
    as_of: date
    out_dir: Path = WORK_DIR / "out"
    cache_dir: Path = WORK_DIR / "downloads"
    deltas: bool = False
    fitrs: bool = True
    gates: bool = True
    contact: str | None = None
    sec_file: Path | None = None
    openfigi_max_age_days: int = 30
    gleif_max_age_days: int = 1
    listing_file_max_age_days: int = 1


def parse_mics(value: str) -> tuple[str, ...]:
    mics = tuple(dict.fromkeys(m.strip().upper() for m in value.split(",") if m.strip()))
    for mic in mics:
        if not re.fullmatch(r"[A-Z0-9]{4}", mic):
            raise ValueError(f"not an ISO 10383 MIC: {mic!r}")
    return mics


def config_dir(env: dict[str, str] | None = None) -> Path:
    env = os.environ if env is None else env
    base = env.get("XDG_CONFIG_HOME") or str(Path(env.get("HOME", "~")).expanduser() / ".config")
    return Path(base) / "pythia"


def load_openfigi_key(env: dict[str, str] | None = None) -> str | None:
    """Return the OpenFIGI key from the environment or the device secrets file.

    The value is kept in-process only: callers must never log, print or persist it.
    """
    env = os.environ if env is None else env
    value = (env.get(OPENFIGI_KEY_ENV) or "").strip()
    if value:
        return value
    return _stored(config_dir(env) / "secrets.json", "openfigi_api_key")


def load_sec_identity(env: dict[str, str] | None = None) -> str | None:
    """Return the SEC plugin's configured contact, `sec_identity` in the device settings file.

    Sent only in the SEC User-Agent; callers must never log, print or persist it.
    """
    return _stored(config_dir(env) / "settings.json", "sec_identity")


def _stored(path: Path, key: str) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    stored = data.get(key) if isinstance(data, dict) else None
    return stored.strip() if isinstance(stored, str) and stored.strip() else None


def sec_user_agent(contact: str | None) -> str | None:
    """SEC requires a contact mailbox; without one the SEC download is refused."""
    if not contact or not _CONTACT_SHAPE.search(contact):
        return None
    return SEC_USER_AGENT.format(contact=contact.strip())
