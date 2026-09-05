"""Inject the sole stored Hermes bearer into only Hermes or Desk, then exec."""

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


def api_key() -> str:
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
        value = json.loads(path.read_text(encoding="utf-8")).get("hermes_api_key")
    except (OSError, ValueError, TypeError):
        fail("the secret store is missing or invalid.")
    if not isinstance(value, str) or len(value.strip()) < 16:
        fail("the Hermes API bearer is missing or invalid.")
    return value.strip()


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in {"hermes", "desk"}:
        fail("the fixed service role or command is missing.")
    command = sys.argv[2:]
    if not Path(command[0]).is_absolute():
        fail("the service executable must be absolute.")
    environment = os.environ.copy()
    for name in ("API_SERVER_KEY", "EODHD_API_TOKEN", "EDGAR_IDENTITY"):
        environment.pop(name, None)
    environment["API_SERVER_KEY"] = api_key()
    os.execve(command[0], command, environment)


if __name__ == "__main__":
    main()
