"""Inject each service's stored Hermes bearer into only that service, then exec.

Hermes gets the API server bearer, the Hermes settings server its own session
token, and Desk both, since it is the only client of either server.
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path
from typing import NoReturn


def fail(message: str) -> NoReturn:
    print(f"Pythia service launch refused: {message}", file=sys.stderr)
    raise SystemExit(1)


def stored(field: str, label: str) -> str:
    raw_root = os.environ.get("PYTHIA_CONFIG_ROOT")
    if not raw_root:
        fail("PYTHIA_CONFIG_ROOT is missing.")
    root = Path(raw_root)
    try:
        root_info = root.lstat()
        path = root / "secrets.json"
        info = path.lstat()
        if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
            fail("the configuration root is not a real directory.")
        if root_info.st_mode & 0o077:
            fail("the configuration root permissions are too open.")
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail("the secret store is not a regular file.")
        if info.st_mode & 0o077:
            fail("the secret store permissions are too open.")
        value = json.loads(path.read_text(encoding="utf-8")).get(field)
    except (OSError, ValueError, TypeError):
        fail("the secret store is missing or invalid.")
    if not isinstance(value, str) or len(value.strip()) < 16:
        fail(f"the {label} is missing or invalid.")
    return value.strip()


BEARERS = {
    "hermes": {"API_SERVER_KEY": ("hermes_api_key", "Hermes API bearer")},
    "hermes-settings": {
        "HERMES_DASHBOARD_SESSION_TOKEN": (
            "hermes_settings_token",
            "Hermes settings bearer",
        )
    },
    "desk": {
        "API_SERVER_KEY": ("hermes_api_key", "Hermes API bearer"),
        "PYTHIA_HERMES_SETTINGS_TOKEN": (
            "hermes_settings_token",
            "Hermes settings bearer",
        ),
    },
}
AMBIENT = (
    "API_SERVER_KEY",
    "HERMES_DASHBOARD_SESSION_TOKEN",
    "PYTHIA_HERMES_SETTINGS_TOKEN",
    "EODHD_API_TOKEN",
    "EDGAR_IDENTITY",
)


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in BEARERS:
        fail("the fixed service role or command is missing.")
    command = sys.argv[2:]
    if not Path(command[0]).is_absolute():
        fail("the service executable must be absolute.")
    environment = os.environ.copy()
    for name in AMBIENT:
        environment.pop(name, None)
    for name, (field, label) in BEARERS[sys.argv[1]].items():
        environment[name] = stored(field, label)
    os.execve(command[0], command, environment)


if __name__ == "__main__":
    main()
