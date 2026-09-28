"""Count a device's read-check currencies against the reference, per venue: `python3 tooling/reference-builder/read_check_audit.py --help`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reference_builder.read_checks import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
