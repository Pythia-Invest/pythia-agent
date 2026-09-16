"""Cache-boundary tests; native dispatch provenance is workspace-view.py."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("desk_view_test", Path(__file__).parents[2] / "managed/plugin/desk_view.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DeskViewTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.reference = "r" * 43
        self.generation = "g" * 43
        self.record = {"version": 1, "generation": self.generation, "owner": "a" * 64, "tab_id": "b" * 16, "session_id": "native", "sequence": 0, "observed_at": 100_000, "expires_at": 160_000, "view": {"route": "/", "title": "New chat"}}
        self.write("generation.json", {"version": 1, "generation": self.generation})
        self.write(self.reference + ".json", self.record)
        self.environment = patch.dict(os.environ, {"PYTHIA_DESK_VIEW_STATE": str(self.root)})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def write(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def read(self, at=100):
        with patch.object(MODULE.time, "time", return_value=at):
            return json.loads(MODULE.desk_view({"view_reference": self.reference}, session_id="native"))

    def test_exact_expiry_and_future_timestamp_are_unavailable(self):
        self.assertTrue(self.read()["available"])
        self.assertEqual(self.read(160)["reason"], "expired")
        self.assertEqual(self.read(99)["reason"], "expired")

    def test_nonfinite_expiry_is_invalid(self):
        self.record["expires_at"] = float("nan")
        self.write(self.reference + ".json", self.record)
        self.assertFalse(self.read()["available"])

    def test_symlink_and_fifo_records_are_not_read(self):
        path = self.root / (self.reference + ".json")
        path.unlink()
        path.symlink_to(self.root / "generation.json")
        self.assertFalse(self.read()["available"])
        path.unlink()
        os.mkfifo(path, 0o600)
        self.assertFalse(self.read()["available"])

    def test_extra_model_fields_do_not_supply_session_or_path(self):
        result = json.loads(MODULE.desk_view({"view_reference": self.reference, "session_id": "native"}, session_id="native"))
        self.assertFalse(result["available"])
        result = json.loads(MODULE.desk_view({"view_reference": self.reference}))
        self.assertFalse(result["available"])

    def test_settings_state_is_not_exposed_from_a_record(self):
        self.record["view"] = {"route": "/settings/providers", "title": "secret", "file": {"path": "secret"}, "credential": "secret"}
        self.write(self.reference + ".json", self.record)
        self.assertEqual(self.read()["view"], {"route": "/settings", "title": "Settings"})


if __name__ == "__main__":
    unittest.main()
