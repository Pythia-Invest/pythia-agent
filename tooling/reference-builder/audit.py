"""Audit a reference snapshot against the identity truth set: `python3 tooling/reference-builder/audit.py --help`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reference_builder.truth_report import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
