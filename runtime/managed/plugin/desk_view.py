"""Read the short-lived, session-bound description published by Pythia Desk."""
from __future__ import annotations

import json
import math
import os
import re
import stat
import time
from pathlib import Path
from typing import Any

REFERENCE = re.compile(r"^[A-Za-z0-9_-]{43}$")
MAX_BYTES = 16_384
SCHEMA = {
    "name": "pythia_desk_view",
    "description": "Read the current Pythia Desk page and observable file selection for the view reference supplied with this turn. This is a brief description, not browser control or full document content. If unavailable, use explicit references or ask the user.",
    "parameters": {
        "type": "object",
        "properties": {"view_reference": {"type": "string", "description": "The view reference supplied with the current turn.", "pattern": "^[A-Za-z0-9_-]{43}$"}},
        "required": ["view_reference"],
        "additionalProperties": False,
    },
}


def _unavailable(reason: str) -> str:
    return json.dumps({"available": False, "reason": reason}, separators=(",", ":"))


def _private(info: os.stat_result, directory: bool = False) -> bool:
    return (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) and not (info.st_mode & 0o077) and info.st_uid == os.getuid()


def _read(root_fd: int, name: str) -> dict[str, Any]:
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root_fd)
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not _private(info) or info.st_size > MAX_BYTES:
            raise ValueError("unsafe record")
        raw = handle.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("oversized record")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("invalid record")
    return result


def _text(value: Any, maximum: int) -> bool:
    return isinstance(value, str) and len(value) <= maximum and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", value)


def _view(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("invalid view")
    route, title = raw.get("route"), raw.get("title")
    if not _text(route, 2048) or not route.startswith("/") or route.startswith("//") or re.search(r"[?#\\\r\n]", route) or not _text(title, 200):
        raise ValueError("invalid page")
    if route == "/settings" or route.startswith("/settings/"):
        return {"route": "/settings", "title": "Settings"}
    result = {"route": route, "title": title}
    if "file" in raw:
        file = raw["file"]
        path = file.get("path") if isinstance(file, dict) else None
        if not _text(path, 2048) or path.startswith("/") or "\\" in path or any(part in (".", "..") for part in path.split("/")):
            raise ValueError("invalid file")
        clean = {"path": path}
        if "hostPath" in file:
            if not _text(file["hostPath"], 4096) or not Path(file["hostPath"]).is_absolute():
                raise ValueError("invalid host path")
            clean["hostPath"] = file["hostPath"]
        for key, maximum in (("heading", 256), ("selection", 4000), ("revision", 200)):
            if key in file:
                if not _text(file[key], maximum):
                    raise ValueError("invalid selection")
                clean[key] = file[key]
        if "page" in file:
            if type(file["page"]) is not int or not 1 <= file["page"] <= 1_000_000:
                raise ValueError("invalid page")
            clean["page"] = file["page"]
        result["file"] = clean
    return result


def desk_view(args: dict[str, Any], **kwargs: Any) -> str:
    if not isinstance(args, dict) or set(args) != {"view_reference"}:
        return _unavailable("invalid_reference")
    reference, session_id = args.get("view_reference"), kwargs.get("session_id")
    if not isinstance(reference, str) or not REFERENCE.fullmatch(reference) or not isinstance(session_id, str) or not session_id:
        return _unavailable("invalid_reference")
    location = os.environ.get("PYTHIA_DESK_VIEW_STATE")
    if not location:
        return _unavailable("no_view_state")
    root_fd = None
    try:
        root = Path(location)
        if not root.is_absolute() or root.resolve(strict=True) != root:
            return _unavailable("unsafe_view_state")
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        if not _private(os.fstat(root_fd), directory=True):
            return _unavailable("unsafe_view_state")
        generation = _read(root_fd, "generation.json")
        record = _read(root_fd, reference + ".json")
        if generation.get("version") != 1 or record.get("version") != 1 or not isinstance(generation.get("generation"), str) or not REFERENCE.fullmatch(generation["generation"]) or record.get("generation") != generation["generation"]:
            return _unavailable("server_restarted")
        if record.get("session_id") != session_id:
            return _unavailable("different_session")
        now = time.time() * 1000
        observed, expires = record.get("observed_at"), record.get("expires_at")
        if type(observed) not in (int, float) or type(expires) not in (int, float) or not math.isfinite(observed) or not math.isfinite(expires) or not (0 <= now - observed < 60_000) or expires <= now or expires > observed + 60_000:
            return _unavailable("expired")
        if not isinstance(record.get("owner"), str) or not re.fullmatch(r"[a-f0-9]{64}", record["owner"]) or not isinstance(record.get("tab_id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", record["tab_id"]) or type(record.get("sequence")) is not int or record["sequence"] < 0:
            raise ValueError("invalid binding")
        view = _view(record.get("view"))
        if _read(root_fd, "generation.json") != generation:
            return _unavailable("server_restarted")
        return json.dumps({"available": True, "observed_at": observed, "expires_at": expires, "view": view}, separators=(",", ":"))
    except (OSError, ValueError, TypeError, RecursionError):
        return _unavailable("missing_or_invalid_view")
    finally:
        if root_fd is not None:
            os.close(root_fd)
