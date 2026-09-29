"""Trust follows a hashed release, never a plugin's name (ADR 0044 A4; ADR 0042, amendment of 2026-09-30).

A plugin's trust level is looked up by the digest of its files, `pythia-plugin-digest@1`: the SHA-256 of the sorted
lines `<posix relpath>\\t<sha256 of the file>\\n`, one per regular file in its directory, leaving out `.git/`,
`__pycache__/`, `*.pyc` and the lifecycle's copy receipt. A symlink anywhere gives no digest, so display. Two files
grant levels:

- Pythia's release grants, `trust.json` beside this module. `release` writes it into the checkout when the payload is
  assembled, before the plugins are copied, so core's copy carries it. A shipped contract whose `signoff` is
  `signed_off` or `grandfathered` is confirm at the digest of exactly its payload files; an `unsigned` one is left
  out. It is generated, never committed.
- The user's local grants, `trust.json` in the Pythia config folder (`PYTHIA_CONFIG_ROOT`), beside settings.json.
  Its entries win in both directions, whatever a contract declares: the user's confirm is their own sign-off. A
  malformed file is ignored with one warning; the release grants still apply.

Anything not granted is display. The levels are display and confirm only. A reference package is granted on
`sha256:<its database's sha256>` (`package_digest`) when the user installs it.

Standard library only, with no package-relative imports, so the lifecycle runs it with Hermes's Python:
`python -P trust.py release --out <file>` (the payloads as JSON on stdin), `grant <plugin dir> <level>` and `status`.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import logging
import os
import re
import stat
import sys
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)
RULE = "pythia-plugin-digest@1"
FILE = "trust.json"
RELEASE = Path(__file__).with_name(FILE)  # Pythia's release grants, generated into core's payload
RECEIPT = ".pythia-managed-copy.json"     # the lifecycle's copy receipt (scripts/dev/plugin-copy.mjs)
DISPLAY, CONFIRM = LEVELS = ("display", "confirm")
CONFIRMING = ("signed_off", "grandfathered")  # the contract sign-offs Pythia's release grants confirm
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
LABELS = ("plugin", "package")  # for people reading the file; lookup is by digest only
MAX_BYTES = 1 << 20
SKIPPED = ("__pycache__", ".git")  # folders Python or a git install keep beside the files: not the release
_digests: dict[str, tuple[tuple, str]] = {}           # directory -> (stat signature, digest)
_files: dict[str, tuple[tuple, dict | None]] = {}      # grants file -> (stat signature, grants, None when malformed)
_warned: set[tuple[str | None, str]] = set()           # (digest, plugin) mismatches already logged


# ---- the digest -------------------------------------------------------------------------------------------------

def digest(directory: Path | str, files: list[str] | None = None) -> str | None:
    """The directory's `pythia-plugin-digest@1`, or None when it holds a symlink or a special file, or is unreadable.

    `files` names exactly the files to cover, as the payload list does when the release grants are generated; by
    default every file in the directory is covered, as installed. Cached on each file's size, mtime and inode."""
    directory = Path(directory)
    try:
        if directory.is_symlink():
            return None
        found = _walk(directory) if files is None else [(name, _regular(directory, name)) for name in files]
    except (OSError, ValueError):
        return None
    signature = tuple(sorted((name, info.st_size, info.st_mtime_ns, info.st_ino) for name, info in found))
    cached = _digests.get(str(directory))
    if cached and cached[0] == signature:
        return cached[1]
    try:
        lines = sorted(f"{name}\t{hashlib.sha256((directory / name).read_bytes()).hexdigest()}\n" for name, _ in found)
    except OSError:
        return None
    value = "sha256:" + hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()
    _digests[str(directory)] = (signature, value)
    return value


def _walk(directory: Path, prefix: str = "") -> list[tuple[str, os.stat_result]]:
    """(relpath, stat) of every file the digest covers; raises ValueError at a symlink or a special file."""
    found = []
    with os.scandir(directory) as entries:
        for entry in entries:
            info, name = entry.stat(follow_symlinks=False), prefix + entry.name
            if stat.S_ISDIR(info.st_mode):
                found += [] if entry.name in SKIPPED else _walk(Path(entry.path), name + "/")
            elif not stat.S_ISREG(info.st_mode):
                raise ValueError(f"{name} is a symlink or a special file")
            elif name != RECEIPT and not entry.name.endswith(".pyc"):
                found.append((name, info))
    return found


def _regular(directory: Path, name: str) -> os.stat_result:
    """The stat of a listed payload file: a regular file under real directories, named relative to `directory`."""
    if name.startswith("/") or "\\" in name or any(part in ("", ".", "..") for part in name.split("/")):
        raise ValueError(f"{name} is not a relative path")
    path = directory
    for part in name.split("/"):
        path = path / part
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f"{name} passes through a symlink")
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"{name} is not a regular file")
    return info


def package_digest(manifest: dict) -> str:
    """The digest a reference package is granted on: its database's sha256, from its `package.json`."""
    return f"sha256:{manifest['database']['sha256']}"


# ---- the grants -------------------------------------------------------------------------------------------------

class Malformed(ValueError):
    """The local grants file is malformed: it is left as it is, and was warned about when it was read."""


def local_file(config_root: Path | str | None = None) -> Path | None:
    """The user's grants file in the Pythia config folder, or None without one (an unset or relative root)."""
    root = str(config_root or os.environ.get("PYTHIA_CONFIG_ROOT") or "")
    return Path(root) / FILE if os.path.isabs(root) else None


def parse(document: object) -> dict[str, dict]:
    """{digest: grant} from a grants document; raises ValueError naming what is wrong."""
    if not isinstance(document, dict) or set(document) != {"schema_version", "digest_rule", "grants"} \
            or document["schema_version"] != 1 or document["digest_rule"] != RULE or not isinstance(document["grants"], list):
        raise ValueError(f"expected schema_version 1, digest_rule {RULE} and a grants list")
    found: dict[str, dict] = {}
    for item in document["grants"]:
        if not isinstance(item, dict) or not {"digest", "level"} <= set(item) <= {"digest", "level", *LABELS} \
                or not isinstance(item["digest"], str) or not DIGEST.fullmatch(item["digest"]) or item["digest"] in found \
                or not all(isinstance(item[label], str) and len(item[label]) <= 128 for label in LABELS if label in item):
            raise ValueError(f"a grant needs one sha256 digest and a level; bad or repeated grant: {str(item)[:160]}")
        if item["level"] not in LEVELS:
            raise ValueError(f"level {item['level']!r} is not one of {', '.join(LEVELS)}")
        found[item["digest"]] = item
    return found


def grants(path: Path | None) -> dict[str, dict] | None:
    """{digest: grant} from a grants file: empty when there is none, None when it is malformed (warned once per
    version of the file). A file that is not regular, is writable by others or exceeds 1 MiB is malformed."""
    try:
        info = os.lstat(path) if path is not None else None
    except FileNotFoundError:
        info = None
    except OSError as error:  # an unreadable config folder counts as a malformed file
        info = error
    if info is None:
        return {}
    signature = repr(info) if isinstance(info, OSError) else (info.st_size, info.st_mtime_ns, info.st_ino, info.st_mode)
    cached = _files.get(str(path))
    if cached and cached[0] == signature:
        return cached[1]
    try:
        if isinstance(info, OSError):
            raise info
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022 or info.st_size > MAX_BYTES:
            raise ValueError("not a regular file of at most 1 MiB that only its owner can write")
        found = parse(json.loads(Path(path).read_bytes()))
    except (OSError, ValueError, RecursionError) as error:
        logger.warning("ignoring the trust grants in %s: %s", path, error)
        found = None
    _files[str(path)] = (signature, found)
    return found


def level(value: str | None, plugin: str | None = None, *, config_root: Path | str | None = None) -> str:
    """The level granted to a digest: the user's local grant, else Pythia's release grant, else display.

    `plugin`, an installed plugin's name, serves only the warning when a grant names it but its files match none."""
    local, release = grants(local_file(config_root)) or {}, grants(RELEASE) or {}
    found = (local.get(value) or release.get(value) or {}).get("level") if value else None
    if found is None and plugin is not None and (value, plugin) not in _warned \
            and any(item.get("plugin") == plugin for item in (*local.values(), *release.values())):
        _warned.add((value, plugin))
        logger.warning("plugin %s is display: its files' digest %s matches none of the trust grants that name it (its "
                       "files changed after they were granted, or the release grants are stale)", plugin,
                       value or "is missing (a symlink or an unreadable file)")
    return found or DISPLAY


def grant(value: str, granted: str, *, config_root: Path | str | None = None, keep: bool = False,
          **labels: str) -> bool:
    """Record the user's grant of a level to a digest in the local grants file; True when the file changed.

    `keep` records it only where the file holds no grant for the digest yet. Raises ValueError without a Pythia
    config folder, for a level other than display or confirm, or when the file is malformed (it is left as it is)."""
    path = local_file(config_root)
    if path is None:
        raise ValueError("no Pythia config folder: PYTHIA_CONFIG_ROOT is not set to an absolute path")
    parse({"schema_version": 1, "digest_rule": RULE, "grants": [{"digest": value, "level": granted, **labels}]})
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with _locked(path.with_name(".trust.lock")):
        found = grants(path)
        if found is None:
            raise Malformed(f"{path} is malformed; fix or remove it first")
        entry = {**found.get(value, {}), "digest": value, "level": granted, **labels}  # labels already there stay
        if found.get(value) == entry or keep and value in found:
            return False
        _write(path, {"schema_version": 1, "digest_rule": RULE, "grants": list({**found, value: entry}.values())})
    return True


def grant_package(manifest: dict, granted: str, *, changed: bool = True) -> bool:
    """Record the user's trust in a reference package they install, by its `package.json`: display always; confirm
    unless the package was already installed and holds a grant. False, with a warning, when nothing was recorded."""
    try:
        return grant(package_digest(manifest), granted, keep=granted == CONFIRM and not changed,
                     package=manifest["build_id"])
    except Malformed:  # already warned about, once
        return False
    except (OSError, ValueError) as error:
        logger.warning("reference package %s: no trust grant recorded, so it is display: %s", manifest["build_id"], error)
        return False


def package_level(manifest: dict) -> str:
    """A reference package's trust level, by its `package.json`: looked up by digest like any contributor's."""
    return level(package_digest(manifest))


def release(payloads: list[dict], out: Path) -> dict:
    """Write Pythia's release grants for the payloads being assembled to `out`: `{plugin, directory, files}` each, where
    `files` is the payload list (every file in the directory, as installed, without one)."""
    entries: dict[str, dict] = {}
    for payload in sorted(payloads, key=lambda item: item["plugin"]):
        directory = Path(payload["directory"])
        contract = json.loads((directory / "contract.json").read_text(encoding="utf-8"))
        if contract["signoff"]["status"] in CONFIRMING:
            value = digest(directory, payload.get("files"))
            if value is None:
                raise ValueError(f"{payload['plugin']}: its payload holds a symlink or an unreadable file")
            entries.setdefault(value, {"digest": value, "level": CONFIRM, "plugin": payload["plugin"]})
    document = {"schema_version": 1, "digest_rule": RULE, "grants": list(entries.values())}
    _write(Path(out), document)
    return document


def _write(path: Path, document: dict) -> None:
    """Atomically, as a private file: a same-directory temporary file, flushed, then renamed over `path`."""
    staging = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    try:
        with open(staging, "x", encoding="utf-8", opener=lambda name, flags: os.open(name, flags, 0o600)) as handle:
            handle.write(json.dumps(document, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        staging.replace(path)
    finally:
        staging.unlink(missing_ok=True)


@contextlib.contextmanager
def _locked(path: Path):
    """One writer of the grants file at a time: the installer, core's first run and this command line."""
    import fcntl
    with open(path, "a", opener=lambda name, flags: os.open(name, flags, 0o600)) as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


# ---- command line -----------------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="trust", description="Pythia's plugin trust grants, by digest.")
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("release", help="write Pythia's release grants; the payloads come as JSON on stdin")
    generate.add_argument("--out", type=Path, required=True)
    granting = commands.add_parser("grant", help="grant the files of a plugin directory a level on this device")
    granting.add_argument("directory", type=Path)
    granting.add_argument("level", choices=LEVELS)
    showing = commands.add_parser("status", help="the grants, and the digest and level of each directory given")
    showing.add_argument("directories", nargs="*", type=Path)
    for command in (granting, showing):
        command.add_argument("--config-root", type=Path, default=os.environ.get("PYTHIA_CONFIG_ROOT"),
                             help="the Pythia config folder (default: PYTHIA_CONFIG_ROOT)")
    args = parser.parse_args(argv)
    try:
        if args.command == "release":
            print(json.dumps(release(json.load(sys.stdin), args.out), indent=2))
        elif args.command == "grant":
            value = digest(args.directory)
            if value is None:
                raise ValueError(f"{args.directory} holds a symlink or cannot be read: it has no digest, so display")
            changed = grant(value, args.level, config_root=args.config_root, plugin=args.directory.resolve().name)
            print(json.dumps({"digest": value, "level": args.level, "changed": changed}))
        else:
            path = local_file(args.config_root)
            print(json.dumps({"release": {"file": str(RELEASE), "grants": list((grants(RELEASE) or {}).values())},
                              "local": {"file": path and str(path), "grants": None if (found := grants(path)) is None
                                        else list(found.values())},
                              "directories": [{"directory": str(item), "digest": (value := digest(item)),
                                               "level": level(value, config_root=args.config_root)}
                                              for item in args.directories]}, indent=2))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"trust: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
