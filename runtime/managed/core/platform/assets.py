"""Read an explicitly selected local plugin artifact, never discover assets."""
from contextlib import contextmanager
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
from threading import Lock


@contextmanager
def _open_asset(root, relative_path, max_bytes):
    if not isinstance(relative_path, str) or not relative_path or '\\' in relative_path:
        raise ValueError('invalid asset path')
    relative = PurePosixPath(relative_path)
    if relative.is_absolute() or str(relative) != relative_path or any(part in ('.', '..') for part in relative.parts):
        raise ValueError('invalid asset path')
    if type(max_bytes) is not int or not 1 <= max_bytes <= 4_194_304:
        raise ValueError('invalid asset limit')
    root = Path(root)
    if not root.is_absolute() or root.resolve() != root:
        raise ValueError('invalid asset root')
    handles = []
    try:
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        handles.append(os.open(root, directory_flags))
        for part in relative.parts[:-1]:
            handles.append(os.open(part, directory_flags, dir_fd=handles[-1]))
        handle = os.open(relative.parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=handles[-1])
        handles.append(handle)
        info = os.fstat(handle)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > max_bytes:
            raise ValueError('invalid asset file')
        yield handle, info
    finally:
        for handle in reversed(handles): os.close(handle)


def _fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
            info.st_ctime_ns, info.st_mode, info.st_nlink)


def _read(handle, info, max_bytes):
    chunks, remaining = [], max_bytes + 1
    while remaining:
        chunk = os.read(handle, min(remaining, 65536))
        if not chunk: break
        chunks.append(chunk)
        remaining -= len(chunk)
    if not remaining: raise ValueError('asset too large')
    encoded = b''.join(chunks)
    if _fingerprint(info) != _fingerprint(os.fstat(handle)) or len(encoded) != info.st_size:
        raise ValueError('asset changed during read')
    return encoded, encoded.decode('utf-8', errors='strict')


def read_bundled_asset(root, relative_path, *, max_bytes=1_048_576):
    with _open_asset(root, relative_path, max_bytes) as (handle, info):
        return _read(handle, info, max_bytes)[1]


class BundledModule:
    """One registered module's metadata, never permissions or retained content.

    Every request opens and validates the current file through its package root.
    Only unchanged metadata reads skip byte IO; explicit content reads always
    read, validate and hash the same opened file. A lock coalesces simultaneous
    metadata reads without retaining file handles or growing a path cache.
    """

    def __init__(self, root, relative_path, *, max_bytes=1_048_576):
        self.root, self.relative_path, self.max_bytes = root, relative_path, max_bytes
        self._cached = None
        self._lock = Lock()

    def read(self, *, include_content=False):
        with self._lock:
            try:
                with _open_asset(self.root, self.relative_path, self.max_bytes) as (handle, info):
                    fingerprint = _fingerprint(info)
                    if not include_content and self._cached and self._cached[0] == fingerprint:
                        return dict(self._cached[1]), None
                    encoded, content = _read(handle, info, self.max_bytes)
                    if not encoded: raise ValueError('empty widget asset')
                    metadata = {'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()}
                    self._cached = fingerprint, metadata
                    return dict(metadata), content if include_content else None
            except (OSError, ValueError, UnicodeError):
                self._cached = None
                raise
