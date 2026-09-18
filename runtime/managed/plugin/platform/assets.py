"""Read an explicitly selected local plugin artifact, never discover assets."""
import os
from pathlib import Path, PurePosixPath
import stat


def read_bundled_asset(root, relative_path, *, max_bytes=1_048_576):
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
        chunks, remaining = [], max_bytes + 1
        while remaining:
            chunk = os.read(handle, min(remaining, 65536))
            if not chunk: break
            chunks.append(chunk)
            remaining -= len(chunk)
        if not remaining: raise ValueError('asset too large')
        return b''.join(chunks).decode('utf-8', errors='strict')
    finally:
        for handle in reversed(handles): os.close(handle)
