"""Reference packages (ADR 0039, docs/architecture/reference-package.md): verify, install and read the one
installed reference catalogue.

A package is a directory holding `package.json` and the one SQLite file it names. Generation (the reference
builder) and consumption (core) meet only here: core reads the package installed under
`<store>/reference/`, never a builder's output folder. `<store>` is Pythia's store directory, `<data>/store`.

Standard library only (its sibling `trust.py` is loaded from its file), so the lifecycle can run it with Hermes's
Python: `python -P reference_package.py install <package> --data-dir <store> [--display]` (also `status`, `move`).
pythia-structure-ignore: one standalone script the lifecycle runs by path; a split would load more siblings by path.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from . import trust
else:  # run as a script (`python -P`): no package, so the sibling is loaded from its file
    trust = importlib.util.module_from_spec(importlib.util.spec_from_file_location("trust", Path(__file__).with_name("trust.py")))
    trust.__spec__.loader.exec_module(trust)

FORMAT = "pythia-reference-package"
FORMAT_VERSION = 5       # the one number core checks: package layout and the SQLite's release.schema_version
PACKAGE_FILE = "package.json"
INSTALLED_FILE = "installed.json"  # which package under packages/ is installed; packages/ is the installer's own
REFUSED_FILE = "refused.json"      # the last package the installer refused, until one installs
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_DATABASE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sqlite3")
_SHA256 = re.compile(r"[0-9a-f]{64}")
_CLAIMS = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json")
_STAGING = ".staging-"
MOVE_LOCK = ".move.lock"  # in the store directory: one mover at a time (`adopt`, and identity's `location`)
STATUS_SCHEMA = {  # core's read-only `reference-status` operation (identity_ops)
    "name": "pythia_reference_status",
    "description": "Describe the reference data installed on this device: its build, as-of date, and each source "
                   "with its as-of date, licence and the notice to show when citing it; also the last package "
                   "that was refused, and why. Local only.",
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}


class PackageError(ValueError):
    """A package that is not installed; the message says why and what to do."""


def reference_dir(data_dir: Path) -> Path:
    return Path(data_dir) / "reference"


# ---- reading the installed package ------------------------------------------------------------------------------

def current(data_dir: Path) -> Path | None:
    """The installed package's SQLite file when this core can read it, else None."""
    found = _installed(reference_dir(data_dir))
    if found is None:
        return None
    directory, manifest = found
    path = directory / manifest["database"]["file"]
    return path if manifest["format_version"] == FORMAT_VERSION and path.is_file() else None


def questions(path: Path) -> list[dict] | None:
    """The open questions the installed package's build left (its optional `claims` file), for the resolution queue,
    or None when they could not be read. `path` is the installed SQLite file."""
    try:
        claims = read_manifest(Path(path).parent).get("claims")
        found = json.loads((Path(path).parent / claims["file"]).read_text(encoding="utf-8")) if claims else {}
    except (OSError, ValueError, PackageError):
        return None
    items = found.get("questions") if isinstance(found, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def release_key(path: Path) -> str:
    """What identifies the installed release for once-per-release work (re-keying, settling the queue): its
    package, build and checksum, so a same-day rebuild with the same build ID is a new release too."""
    return Path(path).parent.name


def status(data_dir: Path) -> dict:
    """For the Desk and the agent: the installed package (build, dates, sources and notices) or None, and the last
    refused package or None."""
    root = reference_dir(data_dir)
    found, pointer = _installed(root), _pointer(root) or {}
    installed = {**_summary(found[1]), "installed_at": pointer.get("installed_at"), "trust": trust.package_level(found[1]),
                 "compatible": found[1]["format_version"] == FORMAT_VERSION} if found else None
    try:
        refused = json.loads((root / REFUSED_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        refused = None
    return {"installed": installed, "refused": refused if isinstance(refused, dict) else None}


def _summary(manifest: dict) -> dict:
    sources = [{key: entry.get(key) for key in ("source", "url", "as_of", "licence", "notice")}
               for entry in manifest["sources"]]
    notices = list(dict.fromkeys(entry["notice"] for entry in sources if entry.get("notice")))
    return {"build_id": manifest["build_id"], "format_version": manifest["format_version"],
            "built_at": manifest["built_at"], "as_of": manifest["as_of"],
            "bytes": manifest["database"]["bytes"], "sha256": manifest["database"]["sha256"],
            "sources": sources, "notices": notices}


def _installed(root: Path) -> tuple[Path, dict] | None:
    pointer = _pointer(root)
    return _package(root, pointer.get("current")) if pointer else None


def _pointer(root: Path) -> dict | None:
    try:
        value = json.loads((root / INSTALLED_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _package(root: Path, name: object) -> tuple[Path, dict] | None:
    if not isinstance(name, str) or not _NAME.fullmatch(name):
        return None
    directory = root / "packages" / name
    try:
        return directory, read_manifest(directory)
    except (OSError, PackageError):
        return None


# ---- validating a package ---------------------------------------------------------------------------------------

def read_manifest(package: Path) -> dict:
    """The package's validated `package.json`; `package` is its directory or the file itself."""
    path = Path(package)
    path = path / PACKAGE_FILE if path.is_dir() else path
    if path.name != PACKAGE_FILE:
        raise PackageError(f"Not a reference package: expected a directory with {PACKAGE_FILE} or the file itself, "
                           f"got {path}.")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise PackageError(f"No {PACKAGE_FILE} at {path.parent}. Build one with `just reference-snapshot`.") from None
    except (OSError, ValueError) as error:
        raise PackageError(f"{path} is not readable JSON: {error}.") from None
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise PackageError(f"{path} is not a Pythia reference package (format is not {FORMAT!r}).")
    version = manifest.get("format_version")
    if type(version) is not int:
        raise PackageError(f"{path} has no integer format_version.")
    database = manifest.get("database")
    problems = [name for name, ok in (
        ("build_id", isinstance(manifest.get("build_id"), str) and _NAME.fullmatch(manifest["build_id"])),
        ("built_at", isinstance(manifest.get("built_at"), str)),
        ("as_of", isinstance(manifest.get("as_of"), str)),
        ("database.file", isinstance(database, dict) and isinstance(database.get("file"), str)
         and _DATABASE.fullmatch(database["file"])),
        ("database.sha256", isinstance(database, dict) and isinstance(database.get("sha256"), str)
         and _SHA256.fullmatch(database["sha256"])),
        ("database.bytes", isinstance(database, dict) and type(database.get("bytes")) is int and database["bytes"] > 0),
        ("sources", isinstance(manifest.get("sources"), list)
         and all(isinstance(entry, dict) and isinstance(entry.get("source"), str) for entry in manifest["sources"])),
        ("quality", isinstance(manifest.get("quality"), dict)),
        ("claims", manifest.get("claims") is None or (
            isinstance(manifest["claims"], dict) and isinstance(manifest["claims"].get("file"), str)
            and _CLAIMS.fullmatch(manifest["claims"]["file"]) and isinstance(manifest["claims"].get("sha256"), str)
            and type(manifest["claims"].get("bytes")) is int)),
    ) if not ok]
    if problems:
        raise PackageError(f"{path} is missing or has invalid fields: {', '.join(problems)}.")
    return manifest


def _compatible(manifest: dict) -> None:
    version = manifest["format_version"]
    if version == FORMAT_VERSION:
        return
    remedy = "Update Pythia to read it." if version > FORMAT_VERSION else \
        "Rebuild it with this checkout's builder (`just reference-snapshot`)."
    raise PackageError(f"Reference package {manifest['build_id']} is format {version}; this Pythia reads format "
                       f"{FORMAT_VERSION}. {remedy} Nothing was installed.")


def _copy_verified(source: Path, target: Path, manifest: dict) -> None:
    """Copy the SQLite file while hashing it; refuse a checksum, size or schema that differs from the manifest."""
    digest, size = hashlib.sha256(), 0
    try:
        with source.open("rb") as reader, target.open("xb") as writer:
            for block in iter(lambda: reader.read(1 << 20), b""):
                digest.update(block)
                size += len(block)
                writer.write(block)
            writer.flush()
            os.fsync(writer.fileno())
    except FileNotFoundError:
        raise PackageError(f"The package names {source.name}, which is not in {source.parent}.") from None
    _verify(digest.hexdigest(), size, target, manifest)


def _copy_claims(source: Path, target: Path, manifest: dict) -> None:
    """Copy the package's claims file; refuse one whose checksum or size differs from the manifest."""
    expected = manifest["claims"]
    try:
        data = source.read_bytes()
    except FileNotFoundError:
        raise PackageError(f"The package names {source.name}, which is not in {source.parent}.") from None
    if hashlib.sha256(data).hexdigest() != expected["sha256"] or len(data) != expected["bytes"]:
        raise PackageError(f"Checksum mismatch for {expected['file']}: the file is damaged or belongs to another "
                           f"build. Nothing was installed.")
    target.write_bytes(data)


def _verify(sha256: str, size: int, path: Path, manifest: dict) -> None:
    expected = manifest["database"]
    if sha256 != expected["sha256"] or size != expected["bytes"]:
        raise PackageError(f"Checksum mismatch for {expected['file']}: package.json says sha256 {expected['sha256']} "
                           f"({expected['bytes']} bytes), the file is sha256 {sha256} ({size} bytes). The file is "
                           f"damaged or belongs to another build. Nothing was installed.")
    try:
        connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            release = dict(connection.execute("SELECT key, value FROM release").fetchall())
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise PackageError(f"{expected['file']} is not a readable reference database: {error}.") from None
    if release.get("schema_version") != str(FORMAT_VERSION) or release.get("release") != manifest["build_id"]:
        raise PackageError(f"{expected['file']} says schema {release.get('schema_version')} and build "
                           f"{release.get('release')}; package.json says format {FORMAT_VERSION} and build "
                           f"{manifest['build_id']}. Nothing was installed.")


def _sha256_file(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


# ---- installing -------------------------------------------------------------------------------------------------

def install(package: Path, data_dir: Path, level: str | None = None) -> dict:
    """Verify a package, make it the installed one with one atomic switch, drop the one it replaced, and record the
    user's trust `level` in it as a grant on its database's digest (`trust.grant_package`; the command line's).

    Installing the package that is already installed changes nothing. A package this core cannot read, or whose
    file does not match its checksum, raises PackageError, changes nothing and is recorded as the last refusal."""
    root = reference_dir(data_dir)
    try:
        result = _install(Path(package), root)
    except PackageError as error:
        _write(root / REFUSED_FILE, {"at": _now(), "package": str(package), "message": str(error)}, make=True)
        raise
    (root / REFUSED_FILE).unlink(missing_ok=True)
    if level:
        trust.grant_package(read_manifest(package), level, changed=result["changed"])
    return {**result, **status(data_dir)}


def _install(package: Path, root: Path, *, replace: bool = True) -> dict:
    manifest = read_manifest(package)
    _compatible(manifest)
    source_dir = package if package.is_dir() else package.parent
    source = source_dir / manifest["database"]["file"]
    try:  # the package given is always checked, even when it is the one installed
        _verify(*_sha256_file(source), source, manifest)
    except FileNotFoundError:
        raise PackageError(f"The package names {source.name}, which is not in {source_dir}.") from None
    name = f"{manifest['build_id']}-{manifest['database']['sha256'][:12]}"
    with _lock(root):
        installed = (_pointer(root) or {}).get("current")
        if installed == name and _whole(root, name) or not replace and _pointer(root) is not None:
            return {"changed": False}
        _sweep(root, keep=installed)  # leftovers of an interrupted install
        staging = root / "packages" / f"{_STAGING}{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        try:
            _copy_verified(source, staging / manifest["database"]["file"], manifest)
            if manifest.get("claims"):
                _copy_claims(source_dir / manifest["claims"]["file"], staging / manifest["claims"]["file"], manifest)
            _write(staging / PACKAGE_FILE, manifest)
            target = root / "packages" / name
            if target.exists():  # a damaged copy of this same package: set it aside for the sweep, then replace it
                target.replace(root / "packages" / f"{_STAGING}damaged-{uuid.uuid4().hex}")
            staging.replace(target)
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)  # only this call's own staging directory
            raise
        _write(root / INSTALLED_FILE, {"current": name, "installed_at": _now()})  # the atomic switch
        _sweep(root, keep=name)
    return {"changed": True}


def _whole(root: Path, name: str) -> bool:
    """The installed copy still reads: its package.json is valid and its database has the recorded size."""
    found = _package(root, name)
    try:
        return bool(found) and (found[0] / found[1]["database"]["file"]).stat().st_size == found[1]["database"]["bytes"]
    except OSError:
        return False


def _sweep(root: Path, keep: str | None) -> None:
    """Drop everything in the installer's own packages/ directory but the installed package."""
    for entry in (root / "packages").iterdir():
        if entry.name == keep:
            continue
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    for entry in root.glob(f".{INSTALLED_FILE}.*"):  # a pointer write that was interrupted
        entry.unlink()


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write(path: Path, value: dict, make: bool = False) -> None:
    if make:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    staging = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    with staging.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(value, indent=2) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(staging, 0o600)
    staging.replace(path)


@contextlib.contextmanager
def _lock(root: Path):
    """One installer at a time per data directory; readers never wait."""
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    (root / "packages").mkdir(exist_ok=True, mode=0o700)
    with locked(root / ".install.lock"):
        yield


@contextlib.contextmanager
def locked(path: Path):
    """Hold the exclusive lock on `path` until the block ends; closing the file releases it."""
    import fcntl
    with Path(path).open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield


def adopt(legacy: Path, data_dir: Path) -> str | None:
    """Move the reference an earlier Pythia installed under `legacy` into `data_dir`, keeping its package name (so its
    release key: nothing is re-keyed): by rename, or across file systems by a verified install that keeps the source.
    Never replaces an installed reference. Returns what happened, for the log; None when there is nothing to move."""
    source, target = reference_dir(legacy), reference_dir(data_dir)
    with locked(Path(data_dir) / MOVE_LOCK):
        if _pointer(source) is None:
            return None
        kept = f"kept {source} ({sum(item.stat().st_size for item in source.rglob('*') if item.is_file())} bytes)"
        if _pointer(target) is not None:
            return f"{kept}: {target} already has an installed reference"
        try:
            os.rename(source, target)  # one file system: one step, nothing copied
            return f"moved {source} to {target}"
        except OSError as error:  # another file system (EXDEV), or a target that is not empty
            reason, found = error.strerror or error, _installed(source)
        try:
            changed = found is not None and _install(found[0], target, replace=False)["changed"]
        except (OSError, PackageError) as refused:
            return f"{kept}: {refused}"
        return f"installed a verified copy of {found[0].name} in {target} ({reason}); {kept}" if changed else \
            f"{kept}: {'its package could not be read' if found is None else f'{target} already has one'}"


# ---- command line -----------------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="reference_package", description="Install or inspect the reference package.")
    parser.add_argument("command", choices=("install", "status", "move"))
    parser.add_argument("package", nargs="?", type=Path, help="install: the package directory or its package.json")
    parser.add_argument("--data-dir", type=Path, required=True, help="Pythia's store directory, <data>/store")
    parser.add_argument("--from", dest="legacy", type=Path, help="move: the directory an earlier Pythia used")
    parser.add_argument("--display", action="store_true", help="install: trust the package to display data, not confirm")
    args = parser.parse_args(argv)
    if args.command == "status":
        print(json.dumps(status(args.data_dir), indent=2))
        return 0
    if args.command == "move" and args.legacy is not None:
        print(json.dumps({"moved": adopt(args.legacy, args.data_dir)}))
        return 0
    if args.command == "move" or args.package is None:
        parser.error("install needs the package directory; move needs --from")
    try:
        result = install(args.package, args.data_dir, trust.DISPLAY if args.display else trust.CONFIRM)
    except PackageError as error:
        print(f"Reference package refused: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
