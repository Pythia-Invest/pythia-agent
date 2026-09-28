"""Reference packages (ADR 0039, docs/architecture/reference-package.md): verify, install and read the one
installed reference catalogue.

A package is a directory holding `package.json` and the one SQLite file it names. Generation (the reference
builder) and consumption (core) meet only here: core reads the package installed under
`<core data dir>/reference/`, never a builder's output folder.

Standard library only, with no package-relative imports, so the lifecycle can run it with Hermes's Python:
`python -P reference_package.py install <package> --data-dir <core data dir>` (also `status`).
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

FORMAT = "pythia-reference-package"
FORMAT_VERSION = 3       # the one number core checks: package layout and the SQLite's release.schema_version
PACKAGE_FILE = "package.json"
INSTALLED_FILE = "installed.json"  # which package under packages/ is installed; packages/ is the installer's own
REFUSED_FILE = "refused.json"      # the last package the installer refused, until one installs
_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_DATABASE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sqlite3")
_SHA256 = re.compile(r"[0-9a-f]{64}")
_STAGING = ".staging-"
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


def release_key(path: Path) -> str:
    """What identifies the installed release for once-per-release work (re-keying, settling the queue): its
    package, build and checksum, so a same-day rebuild with the same build ID is a new release too."""
    return Path(path).parent.name


def status(data_dir: Path) -> dict:
    """For the Desk and the agent: the installed package (build, dates, sources and notices) or None, and the last
    refused package or None."""
    root = reference_dir(data_dir)
    found, pointer = _installed(root), _pointer(root) or {}
    installed = {**_summary(found[1]), "installed_at": pointer.get("installed_at"),
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

def install(package: Path, data_dir: Path) -> dict:
    """Verify a package and make it the installed one with one atomic switch, then drop the one it replaced.

    Installing the package that is already installed changes nothing. A package this core cannot read, or whose
    file does not match its checksum, raises PackageError, changes nothing and is recorded as the last refusal."""
    root = reference_dir(data_dir)
    try:
        result = _install(Path(package), root)
    except PackageError as error:
        _write(root / REFUSED_FILE, {"at": _now(), "package": str(package), "message": str(error)}, make=True)
        raise
    (root / REFUSED_FILE).unlink(missing_ok=True)
    return {**result, **status(data_dir)}


def _install(package: Path, root: Path) -> dict:
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
        if installed == name and _whole(root, name):
            return {"changed": False}
        _sweep(root, keep=installed)  # leftovers of an interrupted install
        staging = root / "packages" / f"{_STAGING}{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        try:
            _copy_verified(source, staging / manifest["database"]["file"], manifest)
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
    import fcntl
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    (root / "packages").mkdir(exist_ok=True, mode=0o700)
    with (root / ".install.lock").open("a") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


# ---- command line -----------------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="reference_package", description="Install or inspect the reference package.")
    parser.add_argument("command", choices=("install", "status"))
    parser.add_argument("package", nargs="?", type=Path, help="install: the package directory or its package.json")
    parser.add_argument("--data-dir", type=Path, required=True, help="the core plugin's data directory")
    args = parser.parse_args(argv)
    if args.command == "status":
        print(json.dumps(status(args.data_dir), indent=2))
        return 0
    if args.package is None:
        parser.error("install needs the package directory")
    try:
        result = install(args.package, args.data_dir)
    except PackageError as error:
        print(f"Reference package refused: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
