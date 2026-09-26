"""Run the reference snapshot builder from a checkout: `python3 tooling/reference-builder/run.py --help`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from reference_builder.main import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
