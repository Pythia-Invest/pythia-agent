"""Regenerate the portable artifact from the runtime-owned contract shapes."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "runtime/managed/plugins/market-data"))
from wire_schema import schema

artifact = ROOT / "packages/market-data/schema.json"
text = json.dumps(schema(), indent=2) + "\n"
if "--check" in sys.argv:
    if json.loads(artifact.read_text()) != schema():
        raise SystemExit("Market-data schema artifact differs; run test/export_schema.py")
else:
    artifact.write_text(text)
