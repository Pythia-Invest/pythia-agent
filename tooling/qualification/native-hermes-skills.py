#!/usr/bin/env python3
"""Provider-free Pythia skill qualification against an exact Hermes checkout."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_hermes_probe import main
from native_hermes_source import source_tree_sha256, validate_source_binding

__all__ = ["main", "source_tree_sha256", "validate_source_binding"]


if __name__ == "__main__":
    raise SystemExit(main())
