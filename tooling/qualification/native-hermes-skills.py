#!/usr/bin/env python3
"""Provider-free Pythia skill qualification against an exact Hermes checkout."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from native_hermes_probe import main


if __name__ == "__main__":
    raise SystemExit(main())
